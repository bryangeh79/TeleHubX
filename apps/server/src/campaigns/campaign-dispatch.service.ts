import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import {
  Campaign,
  CampaignStatus,
  GreetingMode,
  MATURE_DAYS,
  MATURE_MIN_HEALTH,
  PACE_LIMITS,
  PacePreset,
} from './campaign.entity';
import { Account, AccountRole, AccountStatus } from '../accounts/account.entity';
import { CustomerGroup } from '../customer-groups/customer-group.entity';
import { AdTemplate } from '../ad-templates/ad-template.entity';
import { GreetingTemplate } from '../greeting-templates/greeting-template.entity';
import { Task, TaskStatus, TaskType } from '../tasks/task.entity';

/**
 * 时段定义（本地时间小时.分钟） — 见 docs/广告投放规则与引擎机制.md §4.1
 */
const PACE_WINDOWS: Record<PacePreset, Array<{ startH: number; startM: number; endH: number; endM: number }>> = {
  conservative: [
    { startH: 9,  startM: 30, endH: 11, endM: 30 },
    { startH: 14, startM: 0,  endH: 16, endM: 30 },
    { startH: 18, startM: 0,  endH: 20, endM: 30 },
  ],
  balanced: [
    { startH: 9,  startM: 30, endH: 11, endM: 30 },
    { startH: 14, startM: 0,  endH: 16, endM: 30 },
    { startH: 18, startM: 0,  endH: 20, endM: 30 },
  ],
  aggressive: [
    { startH: 10, startM: 0,  endH: 14, endM: 0  },
    { startH: 16, startM: 0,  endH: 20, endM: 0  },
  ],
};

const HARD_DAILY_CAP = 40;          // 每号每天硬上限
const MIN_INTERVAL_SEC = 60;        // 同号最小间隔
const SEND_NIGHT_GUARD_START_H = 9; // 夜间保护起点
const SEND_NIGHT_GUARD_END_H = 21;  // 夜间保护终点

/** Box-Muller 高斯随机 */
function gaussian(mean: number, stdev: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * stdev;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface ResolvedTarget {
  value: string;       // phone / @username / tgUserId
  fromCandidate?: boolean;
  candidateId?: string;
}

interface SendUnit {
  accountId: string;
  accountLabel: string;
  scheduledAt: Date;
  target: string;
  greeting: string | null;
  adContent: string;
}

@Injectable()
export class CampaignDispatchService {
  private readonly logger = new Logger(CampaignDispatchService.name);

  constructor(
    @InjectRepository(Campaign)         private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(Account)          private readonly accountRepo: Repository<Account>,
    @InjectRepository(CustomerGroup)    private readonly groupRepo: Repository<CustomerGroup>,
    @InjectRepository(AdTemplate)       private readonly adRepo: Repository<AdTemplate>,
    @InjectRepository(GreetingTemplate) private readonly greetingRepo: Repository<GreetingTemplate>,
    @InjectRepository(Task)             private readonly taskRepo: Repository<Task>,
  ) {}

  /**
   * 入口：把一个 campaign 展开成 N 个 CAMPAIGN_SINGLE 任务，
   * 每个任务 = (账号, 一个目标, 一条文案, 一个时间)。
   */
  async dispatch(campaignId: string): Promise<{ tasksCreated: number; days: number; accountsUsed: number; targetCount: number }> {
    const campaign = await this.campaignRepo.findOneBy({ id: campaignId });
    if (!campaign) throw new NotFoundException(`Campaign ${campaignId} not found`);
    if (!campaign.tenantId) throw new Error('Campaign 缺少 tenantId');

    // 1. 解析目标
    const targets = await this.resolveTargets(campaign);
    if (!targets.length) throw new Error('没有任何目标可投放');

    // 2. 选账号
    const accounts = await this.selectAccounts(campaign);
    if (!accounts.length) throw new Error('没有可用的发送账号');

    // 3. 计算每号配额 & 跨天
    const pace = (campaign.pacePreset as PacePreset) ?? 'conservative';
    const dailyLimit = Math.min(PACE_LIMITS[pace].dailyLimit, HARD_DAILY_CAP);
    const perAccountTotal = Math.ceil(targets.length / accounts.length);
    const days = Math.max(1, Math.ceil(perAccountTotal / dailyLimit));

    // 4. 加载文案池
    const adVariants = await this.loadAdVariants(campaign);
    if (!adVariants.length) throw new Error('没有可用的广告文案');
    const greetings = await this.loadGreetings(campaign);

    // 5. 分配目标到 (account, day, window)
    const sendUnits = this.distribute({
      targets,
      accounts,
      days,
      dailyLimit,
      pace,
      adVariants,
      greetings,
      greetingMode: (campaign.greetingMode as GreetingMode) ?? GreetingMode.NONE,
    });

    // 6. 落库为 CAMPAIGN_SINGLE 任务
    const tasks = sendUnits.map(u => this.taskRepo.create({
      tenantId: campaign.tenantId,
      type: TaskType.CAMPAIGN_SINGLE,
      status: TaskStatus.PENDING,
      name: `广告投放 · ${campaign.name} → ${u.target}`,
      accountId: u.accountId,
      accountLabel: u.accountLabel,
      scheduledAt: u.scheduledAt,
      payload: {
        campaignId: campaign.id,
        targets: [u.target],
        variants: [{ text: u.adContent }],
        greeting: u.greeting,
        intervalSec: [60, 90], // 单条任务用不上，但保留兼容
      } as any,
    }));
    await this.taskRepo.save(tasks);

    this.logger.log(
      `Campaign ${campaign.id} dispatched: ${tasks.length} tasks, ${days} day(s), ${accounts.length} accounts, ${targets.length} targets`,
    );

    // 7. 更新 campaign 状态 + 记录总目标数
    campaign.status = CampaignStatus.RUNNING;
    campaign.totalTargetCount = targets.length;
    await this.campaignRepo.save(campaign);

    return {
      tasksCreated: tasks.length,
      days,
      accountsUsed: accounts.length,
      targetCount: targets.length,
    };
  }

  // ── helper: 目标解析 ────────────────────────────────────────────────

  private async resolveTargets(campaign: Campaign): Promise<ResolvedTarget[]> {
    const seen = new Set<string>();
    const result: ResolvedTarget[] = [];

    // 来自客户群
    if (campaign.customerGroupIds?.length) {
      const groups = await this.groupRepo.findByIds(campaign.customerGroupIds);
      for (const g of groups) {
        for (const m of g.members ?? []) {
          if (m && !seen.has(m)) {
            seen.add(m);
            const detail = (g.memberDetails ?? []).find(d => d.value === m);
            result.push({
              value: m,
              fromCandidate: detail?.source === 'lead_hunt' || detail?.source === 'pool_filter',
            });
          }
        }
      }
    }

    // 来自手动号码
    for (const t of campaign.targets ?? []) {
      const v = (t || '').trim();
      if (v && !seen.has(v)) { seen.add(v); result.push({ value: v }); }
    }

    return result;
  }

  // ── helper: 账号筛选 ────────────────────────────────────────────────

  private async selectAccounts(campaign: Campaign): Promise<Account[]> {
    const tenantId = campaign.tenantId;

    // 自定义槽位模式：用指定账号
    if (campaign.accountSourceMode === 'manual' && campaign.adAccountIds?.length) {
      const accounts = await this.accountRepo.findByIds(campaign.adAccountIds);
      // 仍然过滤掉 banned / quarantined
      const now = new Date();
      return accounts.filter(a =>
        a.status !== AccountStatus.BANNED &&
        (!a.quarantineUntil || a.quarantineUntil < now),
      );
    }

    // 智能模式：自动筛选
    const now = new Date();
    const matureCutoff = new Date();
    matureCutoff.setDate(matureCutoff.getDate() - MATURE_DAYS);

    const all = await this.accountRepo.find({
      where: [
        { role: AccountRole.AD },
        { role: AccountRole.HYBRID },
      ],
    });

    return all.filter(a => {
      if (a.status === AccountStatus.BANNED) return false;
      if (a.quarantineUntil && a.quarantineUntil > now) return false;
      // 健康度软阈值：< 60 也允许（测试场景），但优先用高分号 → 排序处理
      // 这里保留所有非 banned/quarantine 的，让分配阶段排序
      return true;
    }).sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0));
  }

  // ── helper: 文案池加载 ──────────────────────────────────────────────

  private async loadAdVariants(campaign: Campaign): Promise<string[]> {
    const ids: string[] = [];
    if (campaign.adTemplateId) ids.push(campaign.adTemplateId);
    if (campaign.adTemplateIds?.length) ids.push(...campaign.adTemplateIds);

    const pool: string[] = [];

    if (ids.length) {
      const tpls = await this.adRepo.findByIds(ids);
      for (const t of tpls) {
        if (t.content) pool.push(t.content);
        for (const v of t.variants ?? []) {
          if (v.text) pool.push(v.text);
        }
      }
    }

    // 向后兼容老字段 messageVariants
    for (const v of campaign.messageVariants ?? []) {
      if (v.text) pool.push(v.text);
    }

    return [...new Set(pool)]; // 去重
  }

  private async loadGreetings(campaign: Campaign): Promise<string[]> {
    if (!campaign.greetingTemplateIds?.length) return [];
    const greetings = await this.greetingRepo.findByIds(campaign.greetingTemplateIds);
    const pool: string[] = [];
    for (const g of greetings) {
      if (g.text) pool.push(g.text);
      for (const v of g.variants ?? []) {
        if (v.text) pool.push(v.text);
      }
    }
    return [...new Set(pool)];
  }

  // ── helper: 分配 + 时段打散 ─────────────────────────────────────────

  private distribute(opts: {
    targets: ResolvedTarget[];
    accounts: Account[];
    days: number;
    dailyLimit: number;
    pace: PacePreset;
    adVariants: string[];
    greetings: string[];
    greetingMode: GreetingMode;
  }): SendUnit[] {
    const { targets, accounts, days, dailyLimit, pace, adVariants, greetings, greetingMode } = opts;
    const windows = PACE_WINDOWS[pace];

    // Round-robin 分目标到 (account, day)
    // accountIdx in [0..K), 第 i 个目标 → account[i % K]
    // dayIdx：account 内累计 dailyLimit 个换天
    const buckets: Map<string, ResolvedTarget[]> = new Map(); // key: `${accId}:${day}`
    for (let i = 0; i < targets.length; i++) {
      const accIdx = i % accounts.length;
      const acc = accounts[accIdx];
      // 计算当前 acc 已有多少
      const accTotalSoFar = Math.floor(i / accounts.length);
      const dayIdx = Math.min(days - 1, Math.floor(accTotalSoFar / dailyLimit));
      const key = `${acc.id}:${dayIdx}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(targets[i]);
    }

    const result: SendUnit[] = [];
    const baseDate = new Date();
    baseDate.setSeconds(0, 0);

    for (const [key, bucketTargets] of buckets) {
      const [accountId, dayStr] = key.split(':');
      const dayOffset = parseInt(dayStr, 10);
      const account = accounts.find(a => a.id === accountId)!;

      // 把 bucketTargets 切到各时段
      const perWindow = Math.ceil(bucketTargets.length / windows.length);
      let cursor = 0;
      for (let w = 0; w < windows.length && cursor < bucketTargets.length; w++) {
        const wTargets = bucketTargets.slice(cursor, cursor + perWindow);
        cursor += perWindow;

        const win = windows[w];
        const winStart = new Date(baseDate);
        winStart.setDate(winStart.getDate() + dayOffset);
        winStart.setHours(win.startH, win.startM, 0, 0);
        const winEnd = new Date(winStart);
        winEnd.setHours(win.endH, win.endM, 0, 0);

        const winSecs = (winEnd.getTime() - winStart.getTime()) / 1000;
        const meanInterval = wTargets.length > 0 ? winSecs / wTargets.length : 0;
        const stdev = meanInterval * 0.4;

        let timeCursor = winStart.getTime();
        for (const t of wTargets) {
          const interval = clamp(
            gaussian(meanInterval, stdev),
            MIN_INTERVAL_SEC,
            Math.max(meanInterval * 2, MIN_INTERVAL_SEC * 2),
          );
          timeCursor += interval * 1000;

          // 夜间保护：如果超过 21:00 → 截到当天 21:00
          const scheduledAt = new Date(timeCursor);
          if (scheduledAt.getHours() >= SEND_NIGHT_GUARD_END_H) {
            scheduledAt.setHours(SEND_NIGHT_GUARD_END_H - 1, 59, 0, 0);
          }
          if (scheduledAt.getHours() < SEND_NIGHT_GUARD_START_H) {
            scheduledAt.setHours(SEND_NIGHT_GUARD_START_H, 0, 0, 0);
          }

          // 选文案 + 开场白
          const ad = adVariants[Math.floor(Math.random() * adVariants.length)];
          let greeting: string | null = null;
          if (greetingMode === GreetingMode.FIXED && greetings.length) {
            greeting = greetings[0];
          } else if (greetingMode === GreetingMode.RANDOM && greetings.length) {
            greeting = greetings[Math.floor(Math.random() * greetings.length)];
          }

          result.push({
            accountId: account.id,
            accountLabel: account.phoneNumber ?? account.id.slice(0, 8),
            scheduledAt,
            target: t.value,
            greeting,
            adContent: ad,
          });
        }
      }
    }

    return result;
  }
}

