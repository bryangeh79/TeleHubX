import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import {
  Campaign,
  CampaignStatus,
  GreetingMode,
  MATURE_DAYS,
  MATURE_MIN_HEALTH,
  PACE_LIMITS,
  PacePreset,
  ScheduleMode,
} from './campaign.entity';
import { Account, AccountRole, AccountStatus } from '../accounts/account.entity';
import { CustomerGroup } from '../customer-groups/customer-group.entity';
import { AdTemplate } from '../ad-templates/ad-template.entity';
import { Asset } from '../assets/asset.entity';
import { GreetingTemplate } from '../greeting-templates/greeting-template.entity';
import { LeadCandidate } from '../leads-candidates/lead-candidate.entity';
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
  /** Codex #11: 用户在 ad-template 配了媒体素材 → 透到任务 payload, agent 用 sendFile */
  mediaAssetId?: string | null;
  /** Codex round-7 #5: 候选池来源 → 透到 task payload, agent 发完后回写 lead_candidate.contacted */
  candidateId?: string | null;
}

/** Codex #11: ad variant 含 mediaAssetId, 让 distribute 阶段挑文案时同时知道带不带图 */
interface AdVariantWithMedia {
  text: string;
  mediaAssetId?: string | null;
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
    @InjectRepository(Asset)            private readonly assetRepo: Repository<Asset>,
    @InjectRepository(LeadCandidate)    private readonly candidateRepo: Repository<LeadCandidate>,
  ) {}

  /**
   * 入口：把一个 campaign 展开成 N 个 CAMPAIGN_SINGLE 任务，
   * 每个任务 = (账号, 一个目标, 一条文案, 一个时间)。
   */
  async dispatch(campaignId: string): Promise<{ tasksCreated: number; days: number; accountsUsed: number; targetCount: number }> {
    // Codex round-5 #5: 用事务 + SELECT...FOR UPDATE 行锁原子化幂等检查 + 状态切换
    // 防止双击 send 或并发请求同时通过 status check 创建重复任务
    const campaign = await this.campaignRepo.manager.transaction(async (mgr) => {
      // 1) 行锁住此 campaign (PG 等价 SELECT...FOR UPDATE) 防并发 send
      const c = await mgr.findOne(Campaign, {
        where: { id: campaignId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!c) throw new NotFoundException(`Campaign ${campaignId} not found`);
      if (!c.tenantId) throw new Error('Campaign 缺少 tenantId');

      if (c.status === CampaignStatus.RUNNING) {
        throw new ConflictException('campaign 已在投放中，请先取消或等结束再重新启动');
      }
      if (c.status === CampaignStatus.COMPLETED) {
        throw new ConflictException('campaign 已完成，请创建新的 campaign 继续投放');
      }
      // 兜底: 检查未完成任务残留 (在事务内)
      const existingActive = await mgr
        .createQueryBuilder(Task, 't')
        .where(`t.payload->>'campaignId' = :id`, { id: campaignId })
        .andWhere(`t.status IN (:...st)`, { st: [TaskStatus.PENDING, TaskStatus.RUNNING] })
        .getCount();
      if (existingActive > 0) {
        throw new ConflictException(`campaign 已有 ${existingActive} 个 pending/running 任务, 请先清理`);
      }

      // 2) 原子标 RUNNING (CAS 防并发) — 后续解析/落库在事务外做以避免长事务
      // 这里只占位状态, dispatch 失败时 catch 块回滚
      c.status = CampaignStatus.RUNNING;
      await mgr.save(Campaign, c);
      return c;
    });

    // Codex #5: 资源解析 + 落库在事务外 (避免长事务). 失败时回滚 campaign.status
    try {
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

      // 5. 分配目标
      const isImmediate = (campaign.scheduleMode ?? ScheduleMode.IMMEDIATE) === ScheduleMode.IMMEDIATE;
      const useFastPath = isImmediate && targets.length <= accounts.length * 5;

      const sendUnits = useFastPath
        ? this.fastImmediateDistribute({
            targets, accounts, adVariants, greetings,
            greetingMode: (campaign.greetingMode as GreetingMode) ?? GreetingMode.NONE,
          })
        : this.distribute({
            targets, accounts, days, dailyLimit, pace, adVariants, greetings,
            greetingMode: (campaign.greetingMode as GreetingMode) ?? GreetingMode.NONE,
            scheduleMode: (campaign.scheduleMode as ScheduleMode) ?? ScheduleMode.IMMEDIATE,
            scheduledAt: (campaign as any).scheduledAt,
            scheduleTime: (campaign as any).scheduleTime,
            dayOfWeek: (campaign as any).scheduleDayOfWeek,
          });

      // Codex round-6 #4: sendUnits 空 → 拒绝创建 RUNNING + 0 tasks 的死状态
      // (过期 ONCE 时间 / 当天窗口全结束 / 账号都不可用 等场景)
      if (!sendUnits.length) {
        throw new Error(
          '没有可调度时段 — 所有窗口已过期或调度时间无效, 请重新设置 scheduledAt/scheduleTime',
        );
      }

      // Codex round-6 #3: tasks save + campaign update 用同一事务,
      // 避免 "tasks 已落库 + campaign 保存失败 → DRAFT campaign 但 pending tasks 残留" 的脏数据
      const actualDays = this.countDays(sendUnits.map(u => u.scheduledAt));
      let tasksCreated = 0;
      await this.campaignRepo.manager.transaction(async (mgr) => {
        const tasks = sendUnits.map(u => mgr.create(Task, {
          tenantId: campaign.tenantId,
          type: TaskType.CAMPAIGN_SINGLE,
          status: TaskStatus.PENDING,
          name: `广告投放 · ${campaign.name} → ${u.target}`,
          accountId: u.accountId,
          accountLabel: u.accountLabel,
          scheduledAt: u.scheduledAt,
          payload: {
            campaignId: campaign.id,
            // Codex round-7 #5: 候选池来源 → 用对象形式带 candidateId, agent 发完会 markCandidateContacted
            targets: u.candidateId
              ? [{ value: u.target, candidateId: u.candidateId }]
              : [u.target],
            variants: [{ text: u.adContent, mediaAssetId: u.mediaAssetId ?? null }],
            greeting: u.greeting,
            intervalSec: [60, 90],
          } as any,
        }));
        await mgr.save(Task, tasks);
        tasksCreated = tasks.length;

        // 同事务更新 campaign.totalTargetCount (status 已在外层事务里设为 RUNNING)
        await mgr.update(Campaign, { id: campaign.id }, { totalTargetCount: targets.length });
      });

      this.logger.log(
        `Campaign ${campaign.id} dispatched: ${tasksCreated} tasks, ${actualDays} day(s), ${accounts.length} accounts, ${targets.length} targets, fastPath=${useFastPath}`,
      );

      return {
        tasksCreated,
        days: actualDays,
        accountsUsed: accounts.length,
        targetCount: targets.length,
      };
    } catch (err) {
      // Codex #5 兜底: 任何错误回滚 campaign.status + 清掉本次创建的 task (#3 兜底)
      // 防止 "状态 RUNNING 但实际没派发" 或 "DRAFT 但有 pending tasks 残留"
      this.logger.warn(
        `Campaign ${campaign.id} dispatch failed mid-way, rolling back status: ${err instanceof Error ? err.message : err}`,
      );
      try {
        // 兜底清掉本次可能已落库的 pending tasks (Codex #3: 即便事务保护, 也防 task save 后 catch 之外失败)
        await this.taskRepo
          .createQueryBuilder()
          .delete()
          .from(Task)
          .where(`payload->>'campaignId' = :cid`, { cid: campaign.id })
          .andWhere(`status = :s`, { s: TaskStatus.PENDING })
          .execute();
        await this.campaignRepo.update({ id: campaign.id }, { status: CampaignStatus.DRAFT });
      } catch { /* swallow */ }
      throw err;
    }
  }

  /** 计算这批任务跨了多少天（按本地日期） */
  private countDays(dates: Date[]): number {
    if (!dates.length) return 0;
    const set = new Set(dates.map(d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`));
    return set.size;
  }

  /**
   * 立即模式 + 小批量 fast-path：每个目标分配一个账号，
   * scheduledAt = now + Gaussian(60s ~ 180s)，让 2 个账号不同时发送。
   * 不受时段窗口和夜间保护限制（用户已选立即开始，明确意图）。
   */
  private fastImmediateDistribute(opts: {
    targets: ResolvedTarget[];
    accounts: Account[];
    adVariants: AdVariantWithMedia[];
    greetings: string[];
    greetingMode: GreetingMode;
  }): SendUnit[] {
    const { targets, accounts, adVariants, greetings, greetingMode } = opts;
    const result: SendUnit[] = [];

    // Codex round-7 #3: fast-path 加夜间保护 (规则: 9-21 之外不发送)
    // 启动时若已过 21:00 → baseTime 推到次日 9:00; 若早于 9:00 → 推到当天 9:00
    let baseTime = Date.now();
    const baseDate = new Date(baseTime);
    if (baseDate.getHours() >= SEND_NIGHT_GUARD_END_H) {
      // 已过晚间保护线 → 推到明天早上 9:00
      const tomorrow = new Date(baseDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(SEND_NIGHT_GUARD_START_H, 0, 0, 0);
      baseTime = tomorrow.getTime();
    } else if (baseDate.getHours() < SEND_NIGHT_GUARD_START_H) {
      // 早晨太早 → 推到 9:00
      const today = new Date(baseDate);
      today.setHours(SEND_NIGHT_GUARD_START_H, 0, 0, 0);
      baseTime = today.getTime();
    }

    for (let i = 0; i < targets.length; i++) {
      const acc = accounts[i % accounts.length];
      const sameAccIndex = Math.floor(i / accounts.length);
      const accStagger = (i % accounts.length) * 30 + Math.random() * 20;
      const sameAccGap = sameAccIndex * 90 + (Math.random() - 0.5) * 30;
      const offsetMs = (60 + accStagger + sameAccGap) * 1000;
      let scheduledAt = new Date(baseTime + offsetMs);

      // 二次保护: 累加偏移后若跨过 21:00 → 推到次日 9:00 + 残余偏移
      if (scheduledAt.getHours() >= SEND_NIGHT_GUARD_END_H) {
        const next = new Date(scheduledAt);
        next.setDate(next.getDate() + 1);
        next.setHours(SEND_NIGHT_GUARD_START_H, scheduledAt.getMinutes(), 0, 0);
        scheduledAt = next;
      }

      const ad = adVariants[Math.floor(Math.random() * adVariants.length)];
      let greeting: string | null = null;
      if (greetingMode === GreetingMode.FIXED && greetings.length) {
        greeting = greetings[0];
      } else if (greetingMode === GreetingMode.RANDOM && greetings.length) {
        greeting = greetings[Math.floor(Math.random() * greetings.length)];
      }

      result.push({
        accountId: acc.id,
        accountLabel: acc.phoneNumber ?? acc.id.slice(0, 8),
        scheduledAt,
        target: targets[i].value,
        greeting,
        adContent: ad.text,
        mediaAssetId: ad.mediaAssetId ?? null,
        candidateId: targets[i].candidateId ?? null,    // Codex round-7 #5
      });
    }
    return result;
  }

  // ── Preview (dry-run) ───────────────────────────────────────────────

  /**
   * 预览调度计划：与 dispatch() 逻辑完全相同，但不落库，直接返回摘要。
   * dto 字段与 Campaign 对应字段同名，无需先 create campaign。
   */
  async preview(dto: {
    customerGroupIds?: string[];
    targets?: string[];
    pacePreset?: string;
    accountSourceMode?: string;
    adAccountIds?: string[];
    scheduleMode?: string;
    // Codex round-5 #3 #4: 必须传真实 tenantId + 调度参数, 否则 preview 失真
    tenantId?: string | null;
    scheduledAt?: string | null;
    scheduleTime?: string | null;
    scheduleDayOfWeek?: number | null;
  }): Promise<{
    targetCount: number;
    accountsUsed: number;
    days: number;
    tasksTotal: number;
    dailyLimit: number;
    pacePreset: string;
    fastPath: boolean;
    schedule: Array<{
      day: number;
      date: string;
      windows: Array<{ label: string; count: number; firstAt: string; lastAt: string }>;
      dayTotal: number;
    }>;
  }> {
    const pace = (dto.pacePreset as PacePreset) ?? PacePreset.CONSERVATIVE;
    const paceStr = pace as string;

    // 构造临时 campaign-like 对象 (Codex #3: 用真实 tenantId, 不再 hardcode 'preview')
    const fake = {
      customerGroupIds: dto.customerGroupIds ?? [],
      targets: dto.targets ?? [],
      pacePreset: pace,
      accountSourceMode: dto.accountSourceMode ?? 'auto',
      adAccountIds: dto.adAccountIds ?? [],
      tenantId: dto.tenantId ?? null,
    } as unknown as Campaign;

    const targets = await this.resolveTargets(fake);
    if (!targets.length) {
      return { targetCount: 0, accountsUsed: 0, days: 0, tasksTotal: 0, dailyLimit: 0, pacePreset: paceStr, fastPath: false, schedule: [] };
    }

    const accounts = await this.selectAccounts(fake);
    if (!accounts.length) {
      return { targetCount: targets.length, accountsUsed: 0, days: 0, tasksTotal: 0, dailyLimit: 0, pacePreset: paceStr, fastPath: false, schedule: [] };
    }

    const dailyLimit = Math.min(PACE_LIMITS[pace].dailyLimit, HARD_DAILY_CAP);
    const perAccountTotal = Math.ceil(targets.length / accounts.length);
    const days = Math.max(1, Math.ceil(perAccountTotal / dailyLimit));

    // 与 dispatch() 保持完全一致的 fast-path 判断
    const isImmediate = (dto.scheduleMode ?? 'immediate') === 'immediate';
    const useFastPath = isImmediate && targets.length <= accounts.length * 5;

    const sendUnits = useFastPath
      ? this.fastImmediateDistribute({
          targets, accounts,
          adVariants: [{ text: '[preview]', mediaAssetId: null }],
          greetings: [],
          greetingMode: GreetingMode.NONE,
        })
      : this.distribute({
          targets, accounts, days, dailyLimit, pace,
          adVariants: [{ text: '[preview]', mediaAssetId: null }],
          greetings: [],
          greetingMode: GreetingMode.NONE,
          // Codex #4: preview 也按真实调度参数算时间
          scheduleMode: (dto.scheduleMode as ScheduleMode) ?? ScheduleMode.IMMEDIATE,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          scheduleTime: dto.scheduleTime ?? null,
          dayOfWeek: dto.scheduleDayOfWeek ?? null,
        });

    const pad = (n: number) => String(n).padStart(2, '0');

    // Fast-path 特殊处理：所有任务集中在 1-3 分钟内，单独一个「立即」标签
    if (useFastPath) {
      const sorted = sendUnits.map(u => u.scheduledAt).sort((a, b) => a.getTime() - b.getTime());
      const firstDate = sorted[0];
      const date = `${firstDate.getFullYear()}-${pad(firstDate.getMonth() + 1)}-${pad(firstDate.getDate())}`;
      return {
        targetCount: targets.length,
        accountsUsed: accounts.length,
        days: 1,
        tasksTotal: sendUnits.length,
        dailyLimit,
        pacePreset: paceStr,
        fastPath: true,
        schedule: [{
          day: 0,
          date,
          windows: [{
            label: '立即发送',
            count: sorted.length,
            firstAt: sorted[0].toISOString(),
            lastAt: sorted[sorted.length - 1].toISOString(),
          }],
          dayTotal: sorted.length,
        }],
      };
    }

    // 标准路径：按日期分组，每天内按时段分组
    // Codex round-7 #4: preview 与 distribute 同步窗口逻辑 — 用户传 scheduleTime
    // 时显示自定义窗口, 不再固定 PACE_WINDOWS
    let windows = PACE_WINDOWS[pace];
    if (dto.scheduleTime && /^\d{1,2}:\d{2}$/.test(dto.scheduleTime)) {
      const [h, m] = dto.scheduleTime.split(':').map(Number);
      const startH = Math.max(0, Math.min(23, h ?? 9));
      const startM = Math.max(0, Math.min(59, m ?? 0));
      let endH = startH + 2;
      let endM = startM;
      if (endH > 23) { endH = 23; endM = 59; }
      windows = [{ startH, startM, endH, endM }];
    } else if (dto.scheduleMode === 'once' && dto.scheduledAt) {
      const sa = new Date(dto.scheduledAt);
      const startH = sa.getHours();
      const startM = sa.getMinutes();
      let endH = startH + 2;
      let endM = startM;
      if (endH > 23) { endH = 23; endM = 59; }
      windows = [{ startH, startM, endH, endM }];
    }
    const todayMs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

    // dayOffset → winIdx → times[]
    const agg = new Map<number, Map<number, Date[]>>();
    for (const u of sendUnits) {
      const unitDay = new Date(u.scheduledAt);
      unitDay.setHours(0, 0, 0, 0);
      const dayOffset = Math.round((unitDay.getTime() - todayMs) / 86400000);

      const h = u.scheduledAt.getHours();
      const m = u.scheduledAt.getMinutes();
      // 找对应时段（首个满足 endH/endM 的窗口）
      let winIdx = windows.length - 1;
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        if (h < w.endH || (h === w.endH && m <= w.endM)) {
          winIdx = i;
          break;
        }
      }

      if (!agg.has(dayOffset)) agg.set(dayOffset, new Map());
      const wm = agg.get(dayOffset)!;
      if (!wm.has(winIdx)) wm.set(winIdx, []);
      wm.get(winIdx)!.push(new Date(u.scheduledAt));
    }

    const schedule = Array.from(agg.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([dayOffset, wm]) => {
        const dateObj = new Date(todayMs + dayOffset * 86400000);
        const date = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;

        const winSummary = Array.from(wm.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([wi, times]) => {
            const win = windows[wi];
            const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
            return {
              label: `${pad(win.startH)}:${pad(win.startM)} – ${pad(win.endH)}:${pad(win.endM)}`,
              count: sorted.length,
              firstAt: sorted[0].toISOString(),
              lastAt: sorted[sorted.length - 1].toISOString(),
            };
          });

        return {
          day: dayOffset,
          date,
          windows: winSummary,
          dayTotal: winSummary.reduce((s, w) => s + w.count, 0),
        };
      });

    return {
      targetCount: targets.length,
      accountsUsed: accounts.length,
      days: schedule.length || days,
      tasksTotal: sendUnits.length,
      dailyLimit,
      pacePreset: paceStr,
      fastPath: false,
      schedule,
    };
  }

  // ── helper: 目标解析 ────────────────────────────────────────────────

  private async resolveTargets(campaign: Campaign): Promise<ResolvedTarget[]> {
    const seen = new Set<string>();
    const result: ResolvedTarget[] = [];

    // 来自客户群 — Codex #3: 必须按 campaign.tenantId 过滤防跨租户读取
    if (campaign.customerGroupIds?.length) {
      const where: any = { id: In(campaign.customerGroupIds) };
      if (campaign.tenantId) where.tenantId = campaign.tenantId;
      const groups = await this.groupRepo.find({ where });
      if (groups.length !== campaign.customerGroupIds.length) {
        const found = new Set(groups.map((g) => g.id));
        const missing = campaign.customerGroupIds.filter((id) => !found.has(id));
        throw new ForbiddenException(`customerGroupIds 跨租户或不存在: ${missing.slice(0, 3).join(', ')}`);
      }
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

    // Codex round-7 #5: 候选池来源的目标批量回填 candidateId,
    // 让 dispatch payload 带上 candidateId, agent 发送后能 markCandidateContacted
    const candidateTargets = result.filter((r) => r.fromCandidate);
    if (candidateTargets.length && campaign.tenantId) {
      // 用 username (去掉 @) 或 phone 或 tgUserId 三种方式去匹配 lead_candidate
      const usernames: string[] = [];
      const phones: string[] = [];
      const tgUserIds: string[] = [];
      for (const t of candidateTargets) {
        const v = t.value;
        if (v.startsWith('@') || /^[A-Za-z][A-Za-z0-9_]{4,}$/.test(v)) {
          usernames.push(v.replace(/^@/, ''));
        } else if (/^\+?\d{6,}$/.test(v)) {
          phones.push(v);
        } else {
          tgUserIds.push(v);
        }
      }
      const qb = this.candidateRepo
        .createQueryBuilder('c')
        .where('c."tenantId" = :tid', { tid: campaign.tenantId });
      const conditions: string[] = [];
      const params: any = { tid: campaign.tenantId };
      if (usernames.length) {
        conditions.push('c."tgUsername" IN (:...usernames)');
        params.usernames = usernames;
      }
      if (phones.length) {
        conditions.push('c.phone IN (:...phones)');
        params.phones = phones;
      }
      if (tgUserIds.length) {
        conditions.push('c."tgUserId" IN (:...tgUserIds)');
        params.tgUserIds = tgUserIds;
      }
      if (conditions.length) {
        qb.andWhere(`(${conditions.join(' OR ')})`, params);
        const candidates = await qb.getMany();
        // 建索引: username/phone/tgUserId → candidateId
        const idx = new Map<string, string>();
        for (const c of candidates) {
          if (c.tgUsername) idx.set(c.tgUsername, c.id);
          if (c.phone) idx.set(c.phone, c.id);
          if (c.tgUserId) idx.set(c.tgUserId, c.id);
        }
        for (const t of candidateTargets) {
          const k = t.value.replace(/^@/, '');
          const cid = idx.get(k) ?? idx.get(t.value);
          if (cid) t.candidateId = cid;
        }
      }
    }

    return result;
  }

  // ── helper: 账号筛选 ────────────────────────────────────────────────

  private async selectAccounts(campaign: Campaign): Promise<Account[]> {
    const tenantId = campaign.tenantId;

    // 自定义槽位模式：用指定账号 — Codex #3: 双条件过滤
    if (campaign.accountSourceMode === 'manual' && campaign.adAccountIds?.length) {
      const where: any = { id: In(campaign.adAccountIds) };
      if (tenantId) where.tenantId = tenantId;
      const accounts = await this.accountRepo.find({ where });
      if (accounts.length !== campaign.adAccountIds.length) {
        const found = new Set(accounts.map((a) => a.id));
        const missing = campaign.adAccountIds.filter((id) => !found.has(id));
        throw new ForbiddenException(`adAccountIds 跨租户或不存在: ${missing.slice(0, 3).join(', ')}`);
      }
      const now = new Date();
      return accounts.filter(a =>
        a.status !== AccountStatus.BANNED &&
        (!a.quarantineUntil || a.quarantineUntil < now),
      );
    }

    // 智能模式：自动筛选 — Codex #4: 按 tenantId 过滤防 A 租户用 B 账号发广告
    const now = new Date();
    const matureCutoff = new Date();
    matureCutoff.setDate(matureCutoff.getDate() - MATURE_DAYS);

    const baseWhere = tenantId ? { tenantId } : {};
    const all = await this.accountRepo.find({
      where: [
        { role: AccountRole.AD, ...baseWhere },
        { role: AccountRole.HYBRID, ...baseWhere },
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

  /** Codex #11: 返回带 mediaAssetId 的 variant 数组. 同 template 的 content + variants 共享 mediaAssetId */
  private async loadAdVariants(campaign: Campaign): Promise<AdVariantWithMedia[]> {
    const ids: string[] = [];
    if (campaign.adTemplateId) ids.push(campaign.adTemplateId);
    if (campaign.adTemplateIds?.length) ids.push(...campaign.adTemplateIds);

    const pool: AdVariantWithMedia[] = [];

    if (ids.length) {
      const where: any = { id: In(ids) };
      if (campaign.tenantId) where.tenantId = campaign.tenantId;
      const tpls = await this.adRepo.find({ where });
      if (tpls.length !== ids.length) {
        const found = new Set(tpls.map((t) => t.id));
        const missing = ids.filter((id) => !found.has(id));
        throw new ForbiddenException(`adTemplateIds 跨租户或不存在: ${missing.slice(0, 3).join(', ')}`);
      }
      // Codex round-5 #6: dispatch 阶段预校 mediaAssetId 存在 + tenant 匹配
      // 避免运行时大批 task 因素材不存在/跨租户全部 failed
      const mediaAssetIds = tpls
        .filter((t) => t.hasMedia && t.mediaAssetId)
        .map((t) => t.mediaAssetId);
      if (mediaAssetIds.length) {
        const where: any = { id: In(mediaAssetIds) };
        if (campaign.tenantId) where.tenantId = campaign.tenantId;
        const existing = await this.assetRepo?.find({ where }).catch(() => []) ?? [];
        const validIds = new Set(existing.map((a: any) => a.id));
        const missing = mediaAssetIds.filter((id) => !validIds.has(id));
        if (missing.length) {
          throw new ForbiddenException(
            `广告模板引用的素材跨租户或不存在: ${missing.slice(0, 3).map((id) => id.slice(0, 8)).join(', ')}`,
          );
        }
      }

      for (const t of tpls) {
        const mediaAssetId = t.hasMedia && t.mediaAssetId ? t.mediaAssetId : null;
        if (t.content) pool.push({ text: t.content, mediaAssetId });
        for (const v of t.variants ?? []) {
          if (v.text) pool.push({ text: v.text, mediaAssetId });
        }
      }
    }

    // 向后兼容老字段 messageVariants (没有媒体)
    for (const v of campaign.messageVariants ?? []) {
      if (v.text) pool.push({ text: v.text, mediaAssetId: null });
    }

    // 按 text 去重 (mediaAssetId 同 text 视为同变体)
    const seen = new Set<string>();
    const uniq: AdVariantWithMedia[] = [];
    for (const v of pool) {
      if (seen.has(v.text)) continue;
      seen.add(v.text);
      uniq.push(v);
    }
    return uniq;
  }

  private async loadGreetings(campaign: Campaign): Promise<string[]> {
    if (!campaign.greetingTemplateIds?.length) return [];
    // Codex #3: 按 campaign.tenantId 双条件
    const where: any = { id: In(campaign.greetingTemplateIds) };
    if (campaign.tenantId) where.tenantId = campaign.tenantId;
    const greetings = await this.greetingRepo.find({ where });
    if (greetings.length !== campaign.greetingTemplateIds.length) {
      const found = new Set(greetings.map((g) => g.id));
      const missing = campaign.greetingTemplateIds.filter((id) => !found.has(id));
      throw new ForbiddenException(`greetingTemplateIds 跨租户或不存在: ${missing.slice(0, 3).join(', ')}`);
    }
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
    adVariants: AdVariantWithMedia[];
    greetings: string[];
    greetingMode: GreetingMode;
    /** Codex #7: 用户配置的定时投放起点 (once 模式). 为空则按 now 起 */
    scheduledAt?: Date | null;
    /** daily/weekly 模式的每日投放时间 "HH:mm" */
    scheduleTime?: string | null;
    /** weekly 模式的星期 0-6 (0=周日) */
    dayOfWeek?: number | null;
    /** 调度模式 */
    scheduleMode?: ScheduleMode;
  }): SendUnit[] {
    const { targets, accounts, days, dailyLimit, pace, adVariants, greetings, greetingMode } = opts;

    // Codex round-6 #5: 用户提供 scheduleTime 时, 把第一个时段锚定到该时间,
    // 持续 2 小时. 不再固定用 PACE_WINDOWS 的 9:30 / 14:00 / 18:00 三档.
    // ONCE/DAILY/WEEKLY 模式 + scheduleTime 都生效.
    let windows = PACE_WINDOWS[pace];
    if (opts.scheduleTime && /^\d{1,2}:\d{2}$/.test(opts.scheduleTime)) {
      const [h, m] = opts.scheduleTime.split(':').map(Number);
      // 用户指定 16:00 → 单一时段 16:00-18:00
      const startH = Math.max(0, Math.min(23, h ?? 9));
      const startM = Math.max(0, Math.min(59, m ?? 0));
      let endH = startH + 2;
      let endM = startM;
      if (endH > 23) { endH = 23; endM = 59; }
      windows = [{ startH, startM, endH, endM }];
    } else if (opts.scheduleMode === ScheduleMode.ONCE && opts.scheduledAt) {
      // ONCE 模式没传 scheduleTime 但有 scheduledAt → 用 scheduledAt 的小时分钟
      const sa = new Date(opts.scheduledAt);
      const startH = sa.getHours();
      const startM = sa.getMinutes();
      let endH = startH + 2;
      let endM = startM;
      if (endH > 23) { endH = 23; endM = 59; }
      windows = [{ startH, startM, endH, endM }];
    }

    // Round-robin 分目标到 (account, day)
    const buckets: Map<string, ResolvedTarget[]> = new Map();
    for (let i = 0; i < targets.length; i++) {
      const accIdx = i % accounts.length;
      const acc = accounts[accIdx];
      const accTotalSoFar = Math.floor(i / accounts.length);
      const dayIdx = Math.min(days - 1, Math.floor(accTotalSoFar / dailyLimit));
      const key = `${acc.id}:${dayIdx}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(targets[i]);
    }

    const result: SendUnit[] = [];
    const now = new Date();
    let baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);

    // Codex #7: 按 scheduleMode 选 baseDate
    if (opts.scheduleMode === ScheduleMode.ONCE && opts.scheduledAt) {
      // once: 用户指定时间起算
      baseDate = new Date(opts.scheduledAt);
      baseDate.setHours(0, 0, 0, 0);
    } else if (opts.scheduleMode === ScheduleMode.DAILY && opts.scheduleTime) {
      // daily: 今天的 scheduleTime 已过则推到明天
      const [h, m] = opts.scheduleTime.split(':').map(Number);
      const todayAt = new Date();
      todayAt.setHours(h ?? 9, m ?? 0, 0, 0);
      if (todayAt.getTime() < now.getTime()) baseDate.setDate(baseDate.getDate() + 1);
    } else if (opts.scheduleMode === ScheduleMode.WEEKLY && opts.dayOfWeek !== undefined && opts.dayOfWeek !== null) {
      // weekly: 推到本周或下周指定 dayOfWeek
      const targetDow = opts.dayOfWeek;
      const todayDow = now.getDay();
      let daysAhead = (targetDow - todayDow + 7) % 7;
      if (daysAhead === 0 && opts.scheduleTime) {
        const [h, m] = opts.scheduleTime.split(':').map(Number);
        const todayAt = new Date();
        todayAt.setHours(h ?? 9, m ?? 0, 0, 0);
        if (todayAt.getTime() < now.getTime()) daysAhead = 7;
      } else if (daysAhead === 0) daysAhead = 7;
      baseDate.setDate(baseDate.getDate() + daysAhead);
    } else {
      // immediate (默认): 今天所有时段已结束 → 推到明天
      const todayLastWinEnd = new Date(now);
      const lastWin = windows[windows.length - 1];
      todayLastWinEnd.setHours(lastWin.endH, lastWin.endM, 0, 0);
      if (now.getTime() > todayLastWinEnd.getTime() - 60_000) {
        baseDate.setDate(baseDate.getDate() + 1);
      }
    }

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

        // 跳过已经结束的时段（窗口剩余 < 1 分钟）
        if (winEnd.getTime() <= now.getTime() + 60_000) continue;

        // 起点取 max(窗口起点, 当前时间+60s)，避免把任务排到过去
        const effectiveStart = Math.max(winStart.getTime(), now.getTime() + 60_000);
        // 如果 effectiveStart 已超 winEnd 缓冲，跳过
        if (effectiveStart >= winEnd.getTime() - 60_000) continue;

        const winSecs = (winEnd.getTime() - effectiveStart) / 1000;
        const meanInterval = wTargets.length > 0 ? winSecs / (wTargets.length + 1) : 0;
        const stdev = meanInterval * 0.4;

        let timeCursor = effectiveStart;
        for (const t of wTargets) {
          // interval 上限：不能让 timeCursor 超出 winEnd（留 60s 缓冲）
          const remainingSecs = (winEnd.getTime() - timeCursor) / 1000 - 60;
          const maxInterval = Math.max(MIN_INTERVAL_SEC * 2, remainingSecs);
          const interval = clamp(
            gaussian(meanInterval, stdev),
            MIN_INTERVAL_SEC,
            maxInterval,
          );
          timeCursor += interval * 1000;

          // 夜间保护
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
            adContent: ad.text,
            mediaAssetId: ad.mediaAssetId ?? null,
            candidateId: t.candidateId ?? null,    // Codex round-7 #5
          });
        }
      }
    }

    return result;
  }
}

