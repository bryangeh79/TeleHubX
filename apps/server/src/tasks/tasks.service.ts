import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, LessThan, Repository } from 'typeorm';
import { Account } from '../accounts/account.entity';
import { Campaign, CampaignStatus } from '../campaigns/campaign.entity';
import { CustomerGroupsService } from '../customer-groups/customer-groups.service';
import { DiscoveredGroup, DiscoveredGroupStatus } from '../discovered-groups/discovered-group.entity';
import { LeadCandidatesService } from '../leads-candidates/leads-candidates.service';
import { ensureTenant } from '../auth/tenant-guard.util';
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { Task, TaskStatus, TaskType } from './task.entity';

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** 在第 dayOffset 天的 startHour 至 endHour 之间随机一个时点 (Gaussian-ish, 偏中位) */
function randomDayTime(base: Date, dayOffset: number, startHour: number, endHour: number): Date {
  const day = addDays(base, dayOffset);
  day.setHours(startHour, 0, 0, 0);
  const spanMs = (endHour - startHour) * 60 * 60 * 1000;
  // Box-Muller 近似, 让时间往窗口中点靠拢
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  let g = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * 0.25 + 0.5;
  g = Math.max(0.05, Math.min(0.95, g));
  const picked = new Date(day.getTime() + spanMs * g);

  // 防 picked 在过去 (dayOffset=0 且现在已在窗口内 / 已过窗口的情况)
  // 回退到 now + 1-10 min 随机抖动: 立即可拉, 同时保留少量自然延迟感
  const now = Date.now();
  if (picked.getTime() < now) {
    const jitterMs = 60_000 + Math.floor(Math.random() * 9 * 60_000);
    return new Date(now + jitterMs);
  }
  return picked;
}

/**
 * 任务卡在 running 超过此毫秒数 → watchdog 强制 fail。
 * Codex Bug #2 修复: 之前 15min 太紧, 把 group_bubble (90min) / campaign_single (3h) 等
 * 长任务误杀。提到 4h, agent 内每个 task type 已有自己的精细 timeout (task-runner.ts),
 * 这里只兜底 "agent 真的死了" 场景。
 */
const STUCK_TASK_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 小时

@Injectable()
export class TasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasksService.name);
  private watchdogTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
    @InjectRepository(Campaign) private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(DiscoveredGroup) private readonly discoveredRepo: Repository<DiscoveredGroup>,
    private readonly leadCandidates: LeadCandidatesService,
    private readonly customerGroups: CustomerGroupsService,
  ) {}

  /**
   * 检查 campaign 所有子任务是否都已终结（done/failed）→ 是则标记 completed。
   * 在 update() 中任务进入终态时调用，用于让"全部失败"或"部分成功部分失败"的 campaign 也能正确转 completed。
   */
  private async maybeCompleteCampaign(campaignId: string): Promise<void> {
    const stats = await this.repo
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where(`t.payload->>'campaignId' = :id`, { id: campaignId })
      .groupBy('t.status')
      .getRawMany();
    if (!stats.length) return;

    let total = 0;
    let finished = 0;
    for (const s of stats) {
      const n = parseInt(s.count, 10);
      total += n;
      if (s.status === TaskStatus.DONE || s.status === TaskStatus.FAILED) {
        finished += n;
      }
    }

    if (total > 0 && finished >= total) {
      await this.campaignRepo.update(
        { id: campaignId, status: CampaignStatus.RUNNING },
        { status: CampaignStatus.COMPLETED, completedAt: new Date() },
      );
    }
  }

  onModuleInit() {
    // 每 5 分钟扫描一次，清理卡住的 running 任务
    this.watchdogTimer = setInterval(() => { void this.cleanStuckTasks(); }, 5 * 60 * 1000);
    // 启动时也跑一次（可能上次宕机留下了 running）
    void this.cleanStuckTasks();
  }

  onModuleDestroy() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
  }

  /**
   * Watchdog：把 running 超过 15 分钟的叶子任务强制标记为 failed。
   * 只清理没有子任务的叶子任务（父/编排任务合理地长期处于 running，不处理）。
   * 场景：agent 崩溃/网络断开导致任务永久挂起。
   *
   * 升级 (Part 3):
   *   - 不只标 task FAILED, 还触发同账号「watchdog timeout 级联检测」
   *   - 同账号 1 小时内 ≥ 2 次 watchdog timeout → 自动 quarantine 30min
   *     防止坏账号反复拖累后续任务
   */
  async cleanStuckTasks(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_TASK_TIMEOUT_MS);
    const candidates = await this.repo.find({
      where: { status: TaskStatus.RUNNING, startedAt: LessThan(cutoff) },
      select: ['id', 'type', 'accountId'],
    });
    if (!candidates.length) return;

    // 过滤掉有子任务的父/编排任务（preset_*, keyword_lead_hunt 等）
    const leafTasks: Task[] = [];
    for (const t of candidates) {
      const childCount = await this.repo.count({ where: { parentTaskId: t.id } });
      if (childCount === 0) leafTasks.push(t);
    }
    if (!leafTasks.length) return;

    this.logger.warn(`Watchdog: found ${leafTasks.length} stuck running task(s), force-failing`);
    const affectedAccounts = new Set<string>();
    for (const t of leafTasks) {
      await this.repo.update(t.id, {
        status: TaskStatus.FAILED,
        errorMsg: '任务超时：执行超过 15 分钟未完成（agent 可能已断线）',
        finishedAt: new Date(),
        cancelRequested: true,  // 顺便通知 agent 这任务作废
      });
      this.logger.warn(`Watchdog: force-failed task ${t.id.slice(0, 8)} type=${t.type}`);
      if (t.accountId) affectedAccounts.add(t.accountId);
    }

    // 检查每个受影响账号最近 1 小时的 watchdog timeout 次数
    // Codex Bug #7 修复: 之前 oneHourAgo 没用，导致全历史累计 → 误隔离
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    for (const accountId of affectedAccounts) {
      const recentTimeouts = await this.repo
        .createQueryBuilder('t')
        .where('t."accountId" = :aid', { aid: accountId })
        .andWhere('t.status = :s', { s: TaskStatus.FAILED })
        .andWhere('t."finishedAt" > :since', { since: oneHourAgo })
        .andWhere('t."errorMsg" LIKE :em', { em: '任务超时：执行超过 15 分钟未完成%' })
        .getCount();
      if (recentTimeouts >= 2) {
        const until = new Date(Date.now() + 30 * 60_000);
        await this.accountRepo.update(accountId, {
          quarantineUntil: until,
          quarantineReason: `watchdog timeout cascade (${recentTimeouts} 次失败 in 最近 1 小时)`,
        });
        this.logger.error(
          `Watchdog: account ${accountId.slice(0, 8)} quarantined until ${until.toISOString()} (${recentTimeouts} timeouts)`,
        );
      }
      // 即便没触发 quarantine, 也提示这账号的 client 可能需要 force-reconnect
      // (agent 通过下次 heartbeat 看 quarantineReason 决定)
    }
  }

  async create(dto: CreateTaskDto, tenantId?: string): Promise<Task> {
    let payload = dto.payload as any;
    // chat_script_ab/4p: 注入 A/B/C/D 手机号
    if (
      (dto.type === TaskType.CHAT_SCRIPT_AB || dto.type === TaskType.CHAT_SCRIPT_4P) &&
      payload?.accountAId
    ) {
      payload = await this.enrichChatScriptPayload(payload);
    }
    // media_*/post_channel/campaign_single: 接收方=内池号 → 查 phoneNumber 注入
    if (payload?.targetAccountId) {
      payload = await this.enrichOwnAccountTarget(payload);
    }
    // PRESET_* 组合配套: 不是单点执行, 展开成多日子任务
    if (
      dto.type === TaskType.PRESET_WARMUP_7D ||
      dto.type === TaskType.PRESET_RAMPUP_7D ||
      dto.type === TaskType.PRESET_FULL_14D ||
      dto.type === TaskType.PRESET_MATURE_OPS ||
      dto.type === TaskType.KEYWORD_LEAD_HUNT
    ) {
      return this.expandPreset(dto, tenantId);
    }

    const task = this.repo.create({
      ...dto,
      payload,
      scheduledAt: new Date(dto.scheduledAt),
      tenantId: tenantId ?? null,
      status: TaskStatus.PENDING,
      progress: 0,
    });
    return this.repo.save(task);
  }

  // ─── PRESET orchestrator ───────────────────────────────────────────
  /**
   * 把 preset_* 组合任务展开为 N 个真正能执行的子任务.
   * 父任务标 done + errorMsg='已展开为 N 个子任务' (作为历史记录),
   * 子任务在调度页正常列出, agent 按 scheduledAt 逐个领取.
   */
  private async expandPreset(dto: CreateTaskDto, tenantId?: string): Promise<Task> {
    const start = new Date(dto.scheduledAt);
    const baseName = dto.name;

    let subs: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];

    const payloadHint = (dto.payload as any) ?? {};
    if (dto.type === TaskType.PRESET_WARMUP_7D) {
      subs = this.buildWarmup7d(start, baseName, payloadHint);
    } else if (dto.type === TaskType.PRESET_RAMPUP_7D) {
      subs = this.buildRampup7d(start, baseName, payloadHint);
    } else if (dto.type === TaskType.PRESET_FULL_14D) {
      subs = [
        ...this.buildWarmup7d(start, baseName + ' · 阶段 1', payloadHint),
        ...this.buildRampup7d(addDays(start, 7), baseName + ' · 阶段 2', payloadHint),
      ];
    } else if (dto.type === TaskType.PRESET_MATURE_OPS) {
      subs = this.buildMatureOps7d(start, baseName, payloadHint);
    } else if (dto.type === TaskType.KEYWORD_LEAD_HUNT) {
      subs = this.buildKeywordLeadHunt(start, baseName, payloadHint);
    }

    // 先创建父任务 (待运行状态作为"主任务"展示, 子任务进度反推父任务进度)
    const parent = await this.repo.save(this.repo.create({
      ...dto,
      scheduledAt: start,
      tenantId: tenantId ?? null,
      status: TaskStatus.PENDING,
      progress: 0,
    }));

    // 是否 keyword_lead_hunt? 子任务 payload 注入 huntTaskId
    const isHunt = dto.type === TaskType.KEYWORD_LEAD_HUNT;

    // 再创建子任务 + 链接 parentTaskId
    let savedCount = 0;
    for (const s of subs) {
      const childPayload = isHunt
        ? { ...s.payload, huntTaskId: parent.id }
        : s.payload;
      const sub = this.repo.create({
        name: s.name,
        type: s.type,
        accountId: dto.accountId ?? '',
        accountLabel: dto.accountLabel ?? null,
        payload: childPayload,
        scheduledAt: s.scheduledAt,
        tenantId: tenantId ?? null,
        parentTaskId: parent.id,
        status: TaskStatus.PENDING,
        progress: 0,
      });
      await this.repo.save(sub);
      savedCount++;
    }
    return parent;
  }

  /** 默认安全频道池 — 几乎肯定长期存在的公开 TG 频道 (3 个跨语种) */
  private readonly DEFAULT_BROWSE_CHANNELS = ['@telegram', '@durov', '@trendingbot'];

  /**
   * 7 天养号 — 严格按 PDF / CLAUDE.md P0→P4 设计:
   *   D1 (P0 沉默期)  : IDLE_KEEPALIVE × 1
   *   D2 (P1 浏览)    : BROWSE_CHANNEL × 2 频道 (各停 30-60s)
   *   D3 (P2 轻互动)  : JOIN_CHANNELS 1-2 频道 + REACTION_BOOST 3-5 个 👍
   *   D4-5 (P3 社交建立): JOIN_GROUPS 1 公共讨论群 + GROUP_BUBBLE 群里发短句
   *   D6-7 (P4 综合)   : PROFILE_UPDATE + BROWSE_CHANNEL 多频道
   *
   * payload.channels[] 覆盖默认频道
   * payload.groups[] 提供可加入的群 (D4-5 GROUP_BUBBLE 用), 没有 → 退化成 BROWSE_CHANNEL
   */
  private buildWarmup7d(start: Date, baseName: string, payloadHint: any = {}): Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> {
    const out: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];
    const channels: string[] = Array.isArray(payloadHint.channels) && payloadHint.channels.length
      ? payloadHint.channels : this.DEFAULT_BROWSE_CHANNELS;
    const groups: string[] = Array.isArray(payloadHint.groups) ? payloadHint.groups : [];
    const ch = (i: number) => channels[i % channels.length];

    // ── D1 (P0 沉默期): 仅保活 ─────────────────────────────
    out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, 0, 10, 22), name: `${baseName} · D1 · 保活 (P0 沉默期)`, payload: {} });

    // ── D2 (P1 浏览): 2 个频道 ─────────────────────────────
    out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 1, 10, 13), name: `${baseName} · D2 · 浏览频道 #1`, payload: { channels: [ch(0)], readDurationSec: [30, 60] } });
    out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 1, 18, 22), name: `${baseName} · D2 · 浏览频道 #2`, payload: { channels: [ch(1)], readDurationSec: [30, 60] } });

    // ── D3 (P2 轻互动): Follow 1-2 频道 + Reaction 3-5 个 ──
    const d3FollowCount = Math.min(2, channels.length);
    out.push({
      type: TaskType.JOIN_CHANNELS,
      scheduledAt: randomDayTime(start, 2, 10, 13),
      name: `${baseName} · D3 · Follow ${d3FollowCount} 频道`,
      payload: { channels: channels.slice(0, d3FollowCount) },
    });
    out.push({ type: TaskType.REACTION_BOOST, scheduledAt: randomDayTime(start, 2, 18, 22), name: `${baseName} · D3 · 给消息点赞`, payload: { tgChatId: ch(0), count: [3, 5], emojiPool: ['👍', '❤️', '🔥'] } });

    // ── D4 (P3 社交建立): 加群 + 群内冒泡 (无 group → 浏览兜底) ──
    if (groups.length) {
      out.push({ type: TaskType.JOIN_GROUPS, scheduledAt: randomDayTime(start, 3, 10, 13), name: `${baseName} · D4 · 加入讨论群`, payload: { chatIds: [groups[0]], inviteIntervalSec: [60, 180] } });
      out.push({ type: TaskType.GROUP_BUBBLE, scheduledAt: randomDayTime(start, 3, 19, 22), name: `${baseName} · D4 · 群内冒泡`, payload: { tgChatId: groups[0], count: [1, 2] } });
    } else {
      // payload 没给群 → 用 BROWSE 兜底, 不强制租户提供
      out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 3, 10, 13), name: `${baseName} · D4 · 浏览频道 (无群兜底)`, payload: { channels: [ch(0), ch(1)].slice(0, channels.length), readDurationSec: [30, 90] } });
      out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, 3, 20, 23), name: `${baseName} · D4 · 晚间保活`, payload: {} });
    }

    // ── D5 (P3 群活跃): 群内再冒泡 1-2 条 (无群 → REACTION) ──
    if (groups.length) {
      out.push({ type: TaskType.GROUP_BUBBLE, scheduledAt: randomDayTime(start, 4, 11, 14), name: `${baseName} · D5 · 群内冒泡 #2`, payload: { tgChatId: groups[0], count: [1, 2] } });
      out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 4, 19, 22), name: `${baseName} · D5 · 晚间浏览`, payload: { channels: [ch(0)], readDurationSec: [30, 90] } });
    } else {
      out.push({ type: TaskType.REACTION_BOOST, scheduledAt: randomDayTime(start, 4, 11, 14), name: `${baseName} · D5 · 频道点赞`, payload: { tgChatId: ch(0), count: [3, 5], emojiPool: ['👍', '❤️'] } });
      out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 4, 19, 22), name: `${baseName} · D5 · 晚间浏览`, payload: { channels: [ch(1)], readDurationSec: [30, 90] } });
    }

    // ── D6 (P4 资料): 更新签名 + 浏览多频道 ──────────────
    out.push({ type: TaskType.PROFILE_UPDATE, scheduledAt: randomDayTime(start, 5, 9, 12), name: `${baseName} · D6 · 更新签名`, payload: { bio: '热爱生活 · 分享日常 ✨' } });
    out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 5, 14, 17), name: `${baseName} · D6 · 多频道浏览`, payload: { channels: channels.slice(0, Math.min(2, channels.length)), readDurationSec: [30, 90] } });
    out.push({ type: TaskType.REACTION_BOOST, scheduledAt: randomDayTime(start, 5, 19, 22), name: `${baseName} · D6 · 晚间点赞`, payload: { tgChatId: ch(0), count: [3, 6], emojiPool: ['👍', '❤️', '🔥', '🎉'] } });

    // ── D7 (P4 综合): 多频道浏览 × 2 + reaction ──────────
    out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 6, 9, 12), name: `${baseName} · D7 · 早间多频道浏览`, payload: { channels: channels.slice(0, Math.min(2, channels.length)), readDurationSec: [40, 100] } });
    out.push({ type: TaskType.REACTION_BOOST, scheduledAt: randomDayTime(start, 6, 14, 17), name: `${baseName} · D7 · 下午点赞`, payload: { tgChatId: ch(0), count: [3, 5], emojiPool: ['👍', '🔥'] } });
    out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 6, 19, 22), name: `${baseName} · D7 · 晚间多频道浏览`, payload: { channels: channels.slice(0, Math.min(3, channels.length)), readDurationSec: [40, 120] } });

    return out;
  }

  /**
   * 7 天运营热身 (Day 8-14) — 按 PDF 设计, 活跃度爬坡到主动触达:
   *   D8-9: JOIN_GROUPS_BY_KEYWORD 关键词搜群 + 浏览
   *   D10-11: GROUP_BUBBLE 群里冒泡 + REACTION_BOOST
   *   D12-13: CONTACT_ADD 加联系人 (mild 跳过)
   *   D14: CAMPAIGN_SINGLE 试发 (仅 aggressive 模式)
   *
   * payload:
   *   - keywords[]: 用于 JOIN_GROUPS_BY_KEYWORD (没给则退化为 BROWSE)
   *   - groups[]: 用于 GROUP_BUBBLE (没给则退化为 REACTION)
   *   - contactTargets[]: 用于 CONTACT_ADD (没给则退化为 BROWSE)
   *   - campaignTargets[] + campaignVariants[]: 用于 CAMPAIGN_SINGLE (没给则退化)
   *   - intensity: 'mild' | 'aggressive' (默认 mild — 不发 CONTACT_ADD/CAMPAIGN_SINGLE)
   */
  private buildRampup7d(start: Date, baseName: string, payloadHint: any = {}): Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> {
    const out: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];
    const channels: string[] = Array.isArray(payloadHint.channels) && payloadHint.channels.length
      ? payloadHint.channels : this.DEFAULT_BROWSE_CHANNELS;
    const keywords: string[] = Array.isArray(payloadHint.keywords) ? payloadHint.keywords : [];
    const groups: string[] = Array.isArray(payloadHint.groups) ? payloadHint.groups : [];
    const contactTargets: any[] = Array.isArray(payloadHint.contactTargets) ? payloadHint.contactTargets : [];
    const campaignTargets: any[] = Array.isArray(payloadHint.campaignTargets) ? payloadHint.campaignTargets : [];
    const campaignVariants: string[] = Array.isArray(payloadHint.campaignVariants) ? payloadHint.campaignVariants : [];
    const intensity: 'mild' | 'aggressive' = payloadHint.intensity === 'aggressive' ? 'aggressive' : 'mild';
    const ch = (i: number) => channels[i % channels.length];

    // ── D8-9 (P3 群组扩展): 关键词搜群 + 浏览 ──────────────
    for (let day = 0; day <= 1; day++) {
      const lbl = day + 8;
      if (keywords.length) {
        out.push({
          type: TaskType.JOIN_GROUPS_BY_KEYWORD,
          scheduledAt: randomDayTime(start, day, 10, 14),
          name: `${baseName} · D${lbl} · 关键词搜群`,
          payload: { keywords, minMembers: 50, maxPerDay: 1 },
        });
      } else {
        out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, day, 10, 14), name: `${baseName} · D${lbl} · 多频道浏览 (无 keywords)`, payload: { channels: channels.slice(0, 2), readDurationSec: [40, 120] } });
      }
      out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, day, 19, 22), name: `${baseName} · D${lbl} · 晚间浏览`, payload: { channels: [ch(day)], readDurationSec: [40, 90] } });
    }

    // ── D10-11 (P4 群活跃): 群冒泡 + Reaction ──────────────
    for (let day = 2; day <= 3; day++) {
      const lbl = day + 8;
      if (groups.length) {
        out.push({ type: TaskType.GROUP_BUBBLE, scheduledAt: randomDayTime(start, day, 11, 15), name: `${baseName} · D${lbl} · 群冒泡`, payload: { tgChatId: groups[day % groups.length], count: [2, 3] } });
      } else {
        out.push({ type: TaskType.REACTION_BOOST, scheduledAt: randomDayTime(start, day, 11, 15), name: `${baseName} · D${lbl} · 频道点赞 (无群兜底)`, payload: { tgChatId: ch(day), count: [3, 6], emojiPool: ['👍', '❤️', '🔥'] } });
      }
      out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, day, 19, 22), name: `${baseName} · D${lbl} · 晚间浏览`, payload: { channels: channels.slice(0, 2), readDurationSec: [30, 90] } });
    }

    // ── D12-13 (开始触达): CONTACT_ADD (仅 aggressive 启用) ─
    for (let day = 4; day <= 5; day++) {
      const lbl = day + 8;
      if (intensity === 'aggressive' && contactTargets.length) {
        out.push({
          type: TaskType.CONTACT_ADD,
          scheduledAt: randomDayTime(start, day, 10, 14),
          name: `${baseName} · D${lbl} · 加联系人 (aggressive)`,
          payload: { mode: 'username', targets: contactTargets.slice(0, 3), maxPerDay: 3 },
        });
      } else {
        out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, day, 10, 14), name: `${baseName} · D${lbl} · 浏览 (mild 模式跳过 contact)`, payload: { channels: channels.slice(0, 2), readDurationSec: [40, 100] } });
      }
      out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, day, 19, 22), name: `${baseName} · D${lbl} · 晚间保活`, payload: {} });
    }

    // ── D14 (终极): CAMPAIGN_SINGLE 试发 (aggressive 才启用) ─
    if (intensity === 'aggressive' && campaignTargets.length && campaignVariants.length >= 3) {
      out.push({
        type: TaskType.CAMPAIGN_SINGLE,
        scheduledAt: randomDayTime(start, 6, 11, 16),
        name: `${baseName} · D14 · 单条群发 (aggressive)`,
        payload: {
          targets: campaignTargets.slice(0, 10),
          variants: campaignVariants,
          intervalSec: [120, 300],
        },
      });
    } else {
      out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, 6, 11, 16), name: `${baseName} · D14 · 浏览 (mild 模式不发 campaign)`, payload: { channels: channels.slice(0, 3), readDurationSec: [40, 100] } });
    }
    out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, 6, 20, 23), name: `${baseName} · D14 · 晚间保活`, payload: {} });

    return out;
  }

  /**
   * 关键词智能引流 — 4 阶段 pipeline (PDF 设计原貌):
   *   阶段 1 (D1-7):   JOIN_GROUPS_BY_KEYWORD 关键词搜群+加, 每天 1-2 个
   *   阶段 2 (D8-9):   沉淀 (IDLE_KEEPALIVE), 让账号在群里"自然"待几天
   *   阶段 3 (D10-25): GROUP_SCRAPE 爬最近加的群成员 → lead_candidates 表
   *   阶段 4 (D26-30): CONTACT_ADD 触达爬到的候选人 (每日上限)
   *
   * payload:
   *   - keywords: string[] (必填)
   *   - maxGroupsPerDay: 每天最多加几个群 (默认 2, ≤3 安全)
   *   - scrapeDelayHours: 加群后等多久再爬 (默认 48h)
   *   - maxOutreachPerDay: 每天触达陌生人上限 (默认 5)
   *   - durationDays: 总天数 (默认 30, 7-90)
   *
   * 注意: 阶段 3/4 的子任务在创建时不知道具体目标 (group/lead 还没爬到),
   * payload 用 sentinel 值: tgChatIds=[], targets=[] 让 executor 在运行时
   * 动态查 (从该账号最近 N 天加入的群 / 该 lead_hunt 流水产生的候选人池).
   * 当前 executor 还不支持 sentinel resolution, 任务会失败但不会卡死.
   * 后续在 group_scrape / contact_add executor 加 dynamic-target fallback.
   */
  /**
   * 关键词智能引流 v2 — 纯候选人收集管线 (no outreach).
   *
   * 用户输入:
   *   - keywords: string[]           关键词
   *   - seedGroups?: string[]        指定群 (可选, 优先来这里拉)
   *   - targetCandidates: number     目标人数
   *   - durationDays: number         总天数
   *
   * 调度策略 (优先级):
   *   有 seedGroups → 先 JOIN seedGroups + 反复 SCRAPE seedGroups
   *   预估 seedYield = len(seedGroups) × 30 候选人
   *   if seedYield >= target → 全程仅靠 seedGroups (周期内反复爬)
   *   else → seed 阶段后, 用关键词搜更多群补足缺口
   */
  private buildKeywordLeadHunt(start: Date, baseName: string, payloadHint: any = {}): Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> {
    const out: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];
    const keywords: string[] = Array.isArray(payloadHint.keywords) && payloadHint.keywords.length
      ? payloadHint.keywords : ['外汇'];
    const seedGroups: string[] = Array.isArray(payloadHint.seedGroups)
      ? payloadHint.seedGroups.map((s: string) => s.trim()).filter(Boolean) : [];
    const targetCandidates: number = payloadHint.targetCandidates ?? 300;
    const durationDays: number = Math.min(90, Math.max(3, payloadHint.durationDays ?? 10));

    const AVG_PER_SCRAPE = 30;
    const SAFE_MAX_GROUPS_PER_DAY = 2;
    const seedYield = seedGroups.length * AVG_PER_SCRAPE;
    const remainingTarget = Math.max(0, targetCandidates - seedYield);

    let dayOffset = 0;

    // ── 阶段 A: seedGroups 优先 ──────────────────────────────
    if (seedGroups.length > 0) {
      // D1: 加入指定群 (idempotent — 已加过 TG 不报错)
      out.push({
        type: TaskType.JOIN_GROUPS,
        scheduledAt: randomDayTime(start, dayOffset, 10, 14),
        name: `${baseName} · D${dayOffset + 1} · 加入指定群 (${seedGroups.length} 个)`,
        payload: { chatIds: seedGroups, inviteIntervalSec: [60, 180] },
      });
      dayOffset++;

      // D2: 爬指定群
      out.push({
        type: TaskType.GROUP_SCRAPE,
        scheduledAt: randomDayTime(start, dayOffset, 12, 18),
        name: `${baseName} · D${dayOffset + 1} · 爬指定群`,
        payload: { tgChatIds: seedGroups, maxScrapePerGroup: AVG_PER_SCRAPE },
      });
      dayOffset++;
    }

    // ── 阶段 B: 不够 → 关键词补足 ────────────────────────────
    if (remainingTarget > 0 && dayOffset < durationDays) {
      const remainingDays = durationDays - dayOffset;
      const needGroups = Math.max(1, Math.ceil(remainingTarget / AVG_PER_SCRAPE));
      const joinDays = Math.max(1, remainingDays - 1);
      let groupsPerDay = Math.max(1, Math.ceil(needGroups / joinDays));
      if (groupsPerDay > SAFE_MAX_GROUPS_PER_DAY) groupsPerDay = SAFE_MAX_GROUPS_PER_DAY;

      // 关键词加群: 接 dayOffset 起, 持续 joinDays 天
      for (let i = 0; i < joinDays; i++) {
        const day = dayOffset + i;
        out.push({
          type: TaskType.JOIN_GROUPS_BY_KEYWORD,
          scheduledAt: randomDayTime(start, day, 10, 16),
          name: `${baseName} · D${day + 1} · 搜词加群`,
          payload: { keywords, minMembers: 50, maxPerDay: groupsPerDay },
        });
      }

      // 爬群: 关键词阶段第 2 天起, 每天爬一次最近加的群
      for (let i = 1; i < remainingDays; i++) {
        const day = dayOffset + i;
        out.push({
          type: TaskType.GROUP_SCRAPE,
          scheduledAt: randomDayTime(start, day, 12, 22),
          name: `${baseName} · D${day + 1} · 爬群 (含指定+关键词加的群)`,
          payload: {
            tgChatIds: seedGroups,  // 把 seed 也带上, 反复爬可能补到新成员
            maxScrapePerGroup: AVG_PER_SCRAPE,
            dynamicSource: 'recent_joins',  // 同时也爬最近加的群
          },
        });
      }
    } else if (seedGroups.length > 0 && dayOffset < durationDays) {
      // 仅 seedGroups 模式: seedYield 已够, 剩余天数继续反复爬 seedGroups
      // (新人会陆续加群, 多次爬能拿到更多候选)
      for (let day = dayOffset; day < durationDays; day += 2) {
        out.push({
          type: TaskType.GROUP_SCRAPE,
          scheduledAt: randomDayTime(start, day, 12, 22),
          name: `${baseName} · D${day + 1} · 复爬指定群`,
          payload: { tgChatIds: seedGroups, maxScrapePerGroup: AVG_PER_SCRAPE },
        });
      }
    }

    return out;
  }

  /**
   * Day 15+ 成熟运营 — 不限期循环, 仅日常维护 (跟 rampup 完全不同):
   *   每日: 1× 多频道浏览 + 1× Reaction + 1× 自有群冒泡 (无群 → IDLE) + 1× 晚间保活
   *
   * 系统按 7 天展开作为「一周配方」, 用户可重复运行 (run-now 复用整个 preset).
   * 真正的 ad/campaign 任务由租户手动派发, 这里只负责让账号"看起来还活着".
   */
  private buildMatureOps7d(start: Date, baseName: string, payloadHint: any = {}): Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> {
    const out: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];
    const channels: string[] = Array.isArray(payloadHint.channels) && payloadHint.channels.length
      ? payloadHint.channels : this.DEFAULT_BROWSE_CHANNELS;
    const ownGroups: string[] = Array.isArray(payloadHint.ownGroups) ? payloadHint.ownGroups : [];
    const ch = (i: number) => channels[i % channels.length];

    for (let day = 0; day < 7; day++) {
      const lbl = day + 15;
      // 早: 多频道浏览
      out.push({ type: TaskType.BROWSE_CHANNEL, scheduledAt: randomDayTime(start, day, 8, 11), name: `${baseName} · D${lbl} · 晨间浏览`, payload: { channels: channels.slice(0, 2), readDurationSec: [30, 90] } });
      // 午: Reaction
      out.push({ type: TaskType.REACTION_BOOST, scheduledAt: randomDayTime(start, day, 12, 15), name: `${baseName} · D${lbl} · 午间点赞`, payload: { tgChatId: ch(day), count: [3, 5], emojiPool: ['👍', '❤️', '🔥'] } });
      // 晚: 自有群冒泡 (没自有群 → IDLE_KEEPALIVE)
      if (ownGroups.length) {
        out.push({ type: TaskType.GROUP_BUBBLE, scheduledAt: randomDayTime(start, day, 18, 21), name: `${baseName} · D${lbl} · 自有群冒泡`, payload: { tgChatId: ownGroups[day % ownGroups.length], count: [1, 2] } });
      } else {
        out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, day, 18, 21), name: `${baseName} · D${lbl} · 保活 (无自有群)`, payload: {} });
      }
      // 深夜: keepalive
      out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, day, 22, 23), name: `${baseName} · D${lbl} · 深夜保活`, payload: {} });
    }
    return out;
  }

  /** 接收方是本租户内池号: 查手机号注入 targetId 给 executor 用 */
  private async enrichOwnAccountTarget(p: any): Promise<any> {
    if (!p.targetAccountId) return p;
    const acc = await this.accountRepo.findOneBy({ id: p.targetAccountId });
    if (!acc?.phoneNumber) return p;
    return { ...p, targetId: p.targetId ?? acc.phoneNumber };
  }

  /** 私聊模式注入各角色 phoneNumber 到 payload, 让 agent executor getEntity 用 */
  private async enrichChatScriptPayload(p: any): Promise<any> {
    const isPrivate = (p.chatMode ?? 'private') === 'private';
    if (!isPrivate) return p;
    const ids = [p.accountAId, p.accountBId, p.accountCId, p.accountDId].filter(Boolean) as string[];
    if (!ids.length) return p;
    const rows = await this.accountRepo.findBy({ id: In(ids) as any });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const phoneOf = (id?: string) => (id ? byId.get(id)?.phoneNumber : undefined);
    return {
      ...p,
      accountAPhone: phoneOf(p.accountAId),
      accountBPhone: phoneOf(p.accountBId),
      accountCPhone: phoneOf(p.accountCId),
      accountDPhone: phoneOf(p.accountDId),
    };
  }

  findAll(filters: { status?: TaskStatus; type?: TaskType; tenantId?: string } = {}): Promise<Task[]> {
    const where: FindOptionsWhere<Task> = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    // 默认隐藏 PRESET 子任务 (parentTaskId 不为空), 只列父任务
    const qb = this.repo.createQueryBuilder('t')
      .where(filters.status ? 't.status = :status' : '1=1', { status: filters.status })
      .andWhere(filters.type ? 't.type = :type' : '1=1', { type: filters.type })
      .andWhere(filters.tenantId ? 't.tenantId = :tid' : '1=1', { tid: filters.tenantId })
      .andWhere('t.parentTaskId IS NULL')
      .orderBy('t.createdAt', 'DESC')
      .limit(500);
    return qb.getMany();
  }

  /** 列出某个父任务下的所有子任务 (preset_* 展开后用) */
  async findChildren(parentTaskId: string): Promise<Task[]> {
    return this.repo.find({
      where: { parentTaskId },
      order: { scheduledAt: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Task> {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException(`Task ${id} not found`);
    return t;
  }

  /** 租户权属保护版 findOne */
  async findOneScoped(id: string, callerTenantId: string | null): Promise<Task> {
    const t = await this.repo.findOneBy({ id });
    return ensureTenant(t, callerTenantId, 'Task');
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const t = await this.findOne(id);
    if (dto.scheduledAt) {
      t.scheduledAt = new Date(dto.scheduledAt);
    }
    // 取消保护 (Codex Bug #3): 用户已 cancel 的任务，agent 后续 PATCH done/progress
    // 不能覆盖回 done。只允许 status→failed (确认取消) 或 errorMsg 写入。
    if (t.cancelRequested) {
      if (dto.status !== undefined && dto.status !== TaskStatus.FAILED) {
        this.logger.warn(
          `[update] task ${id.slice(0, 8)} cancelRequested=true, ignoring status=${dto.status}`,
        );
        // 强制 failed
        if (!t.finishedAt) t.finishedAt = new Date();
        t.status = TaskStatus.FAILED;
      } else if (dto.status === TaskStatus.FAILED) {
        if (!t.finishedAt) t.finishedAt = new Date();
        t.status = TaskStatus.FAILED;
      }
      // errorMsg 仍允许 agent 写入诊断信息
      if (dto.errorMsg !== undefined) t.errorMsg = dto.errorMsg;
      // progress 不更新（防 100% 覆盖）
      const saved = await this.repo.save(t);
      return saved;
    }
    if (dto.name !== undefined) t.name = dto.name;
    if (dto.status !== undefined) {
      // 首次进入 running → 记 startedAt
      if (dto.status === TaskStatus.RUNNING && !t.startedAt) {
        t.startedAt = new Date();
      }
      // 终态 done/failed → 记 finishedAt
      if (
        (dto.status === TaskStatus.DONE || dto.status === TaskStatus.FAILED) &&
        !t.finishedAt
      ) {
        t.finishedAt = new Date();
      }
      t.status = dto.status;
    }
    // Codex Bug #6: 支持 startedAt 显式重置（agent 退回 pending 时清掉）
    if (dto.startedAt !== undefined) {
      t.startedAt = dto.startedAt ? new Date(dto.startedAt) : null;
    }
    if (dto.payload !== undefined) t.payload = dto.payload;
    if (dto.progress !== undefined) t.progress = dto.progress;
    if (dto.errorMsg !== undefined) t.errorMsg = dto.errorMsg;
    const saved = await this.repo.save(t);
    // 子任务状态/进度变化 → 反推父任务汇总
    if (t.parentTaskId && (dto.status !== undefined || dto.progress !== undefined)) {
      await this.recalcParentAggregate(t.parentTaskId).catch(() => {});
    }
    // campaign_single 进入终态 → 触发 campaign 完成检测
    // （包括失败场景：原本 incrementSent 只在成功时触发，失败时 campaign 永远停 running）
    if (
      saved.type === TaskType.CAMPAIGN_SINGLE &&
      (saved.status === TaskStatus.DONE || saved.status === TaskStatus.FAILED)
    ) {
      const campaignId = (saved.payload as any)?.campaignId;
      if (campaignId) {
        this.maybeCompleteCampaign(campaignId).catch(() => {});
      }
    }
    // group_scrape done + 来自 discovered-groups 的「加+爬」流程 → 自动建客户群 + 推进 status
    if (
      saved.type === TaskType.GROUP_SCRAPE &&
      saved.status === TaskStatus.DONE &&
      saved.payload &&
      (saved.payload as any)._autoGroupFromDiscovered
    ) {
      this.autoGroupFromScrape(saved).catch((err) => {
        this.logger.warn(`autoGroupFromScrape failed task=${saved.id}: ${(err as Error).message}`);
      });
    }
    return saved;
  }

  /**
   * 子任务变化时反推父任务汇总:
   *   - progress = round(done / total * 100)
   *   - status: 全部 done/failed → done (有 failed 但有完成的也算 done)
   *            有 running / 有 done → running
   *            否则 pending 不动
   *   - startedAt: 第一次进 running 时记
   *   - finishedAt: 全部完成时记
   */
  private async recalcParentAggregate(parentId: string): Promise<void> {
    const children = await this.repo.find({ where: { parentTaskId: parentId } });
    if (!children.length) return;
    const parent = await this.repo.findOneBy({ id: parentId });
    if (!parent) return;
    if (parent.status === TaskStatus.DONE || parent.status === TaskStatus.FAILED) return; // 已终态不动

    const total = children.length;
    const done = children.filter((c) => c.status === TaskStatus.DONE).length;
    const failed = children.filter((c) => c.status === TaskStatus.FAILED).length;
    const running = children.some((c) => c.status === TaskStatus.RUNNING);

    parent.progress = Math.round((done / total) * 100);
    if (done + failed >= total) {
      // Codex Bug #8: 区分 全成功 / 部分失败 / 全失败
      if (done === 0) {
        // 全失败 → 父任务也失败
        parent.status = TaskStatus.FAILED;
        parent.errorMsg = `全部 ${total} 个子任务失败`;
      } else if (failed > 0) {
        // 部分成功部分失败 → 父任务标 done 但 errorMsg 提示
        parent.status = TaskStatus.DONE;
        parent.errorMsg = `部分完成: ${done}/${total} 成功, ${failed} 失败`;
      } else {
        parent.status = TaskStatus.DONE;
      }
      if (!parent.finishedAt) parent.finishedAt = new Date();
    } else if (running || done > 0 || failed > 0) {
      if (parent.status !== TaskStatus.RUNNING) {
        parent.status = TaskStatus.RUNNING;
        if (!parent.startedAt) parent.startedAt = new Date();
      }
    }
    await this.repo.save(parent);
  }

  async pause(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.RUNNING) return t;
    t.status = TaskStatus.PAUSED;
    return this.repo.save(t);
  }

  async resume(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.PAUSED) return t;
    t.status = TaskStatus.RUNNING;
    return this.repo.save(t);
  }

  /**
   * 强制停止任务。无论当前状态都标记 FAILED + errorMsg='Cancelled by user'。
   * - pending：还没被 agent 领，DB 改完就生效
   * - running：agent 仍在跑当前 turn（Node 无法 kill 中途 await），但任务对用户视为已停。
   *   agent 完成当前 turn 后 PATCH 回 done 也会被 cancel 状态覆盖
   * - paused：直接 cancel
   * 已 done 的任务忽略 (cancel 历史已完成的没意义)
   */
  async cancel(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status === TaskStatus.DONE || t.status === TaskStatus.FAILED) return t;
    // 关键: 同时 set cancelRequested=true, 让 agent 在拉到此任务前 / RPC 之间能看到信号
    t.status = TaskStatus.FAILED;
    t.errorMsg = 'Cancelled by user';
    t.finishedAt = new Date();
    t.cancelRequested = true;
    return this.repo.save(t);
  }

  /**
   * 紧急按钮：批量取消所有 pending/running/paused 任务。
   * 一次 UPDATE 完成，agent 下次 dispatch 不再领取这些。
   */
  async cancelAll(tenantId?: string): Promise<{ cancelled: number }> {
    const qb = this.repo
      .createQueryBuilder()
      .update(Task)
      .set({
        status: TaskStatus.FAILED,
        errorMsg: 'Cancelled (bulk stop)',
        finishedAt: new Date(),
        cancelRequested: true,    // 通知 agent 立即停掉所有 in-flight 执行
      })
      .where('status IN (:...statuses)', {
        statuses: [TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.PAUSED],
      });
    if (tenantId) qb.andWhere('"tenantId" = :tid', { tid: tenantId });
    const res = await qb.execute();
    return { cancelled: res.affected ?? 0 };
  }

  async retry(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.FAILED) return t;
    t.status = TaskStatus.PENDING;
    t.errorMsg = null;
    t.progress = 0;
    t.startedAt = null;
    t.finishedAt = null;
    t.cancelRequested = false;  // Codex #1: 清取消标志, 否则 agent 拉到立即被强制 failed 死循环
    t.scheduledAt = new Date();
    return this.repo.save(t);
  }

  /**
   * 重新激活父级编排任务（preset_*, keyword_lead_hunt 等）。
   * 父任务被误标 failed 时，恢复为 running 让其子任务按原计划继续。
   * 不重置 startedAt（保留首次开始时间），仅清 errorMsg/finishedAt。
   * 也会把同一父任务下因「上级任务目标已达, 跳过」而被取消的子任务恢复 pending。
   */
  async reactivate(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.FAILED) return t;

    t.status = TaskStatus.RUNNING;
    t.errorMsg = null;
    t.finishedAt = null;
    t.cancelRequested = false;  // Codex #1: 同步清取消标志
    const saved = await this.repo.save(t);

    // 父任务被恢复 → 它跑过 cancelChildren 把子任务标 failed 的，全部恢复回 pending
    await this.repo
      .createQueryBuilder()
      .update(Task)
      .set({
        status: TaskStatus.PENDING,
        errorMsg: null,
        progress: 0,
        startedAt: null,
        finishedAt: null,
        cancelRequested: false,    // 子任务也清
      })
      .where('parentTaskId = :pid', { pid: id })
      .andWhere('status = :s', { s: TaskStatus.FAILED })
      .andWhere(`"errorMsg" = :msg`, { msg: '上级任务目标已达, 跳过' })
      .execute();

    return saved;
  }

  /**
   * 批量重试某个 campaign 下所有 failed 任务。
   * 把它们改回 pending + 清空错误 + scheduledAt=now，
   * agent 下轮 dispatch 自动拉取重新执行。
   */
  async retryAllFailedOfCampaign(campaignId: string): Promise<{ retried: number }> {
    const res = await this.repo
      .createQueryBuilder()
      .update(Task)
      .set({
        status: TaskStatus.PENDING,
        errorMsg: null,
        progress: 0,
        startedAt: null,
        finishedAt: null,
        cancelRequested: false,    // Codex #1: 同步清
        scheduledAt: () => 'NOW()',
      })
      .where('status = :s', { s: TaskStatus.FAILED })
      .andWhere(`payload->>'campaignId' = :cid`, { cid: campaignId })
      .execute();
    return { retried: res.affected ?? 0 };
  }

  /**
   * 复用：基于现有任务 clone 一个新任务并立即执行。
   * 不影响原任务，原任务保留作为历史。
   */
  async cloneAndRunNow(id: string): Promise<Task> {
    const orig = await this.findOne(id);
    const clone = this.repo.create({
      tenantId: orig.tenantId,
      name: orig.name,
      type: orig.type,
      accountId: orig.accountId,
      accountLabel: orig.accountLabel,
      payload: orig.payload,
      scheduledAt: new Date(),
      status: TaskStatus.PENDING,
      progress: 0,
    });
    return this.repo.save(clone);
  }

  async remove(id: string): Promise<void> {
    const t = await this.repo.findOneBy({ id });
    if (!t) return;  // 幂等: 任务不存在视为已删除, 不抛 404

    // 关键：如果 task 还在 running，先 set cancelRequested=true 让 agent 看到信号，
    // 60s 后由 watchdog 真删 (避免 hung agent 还在跑、删了行又被新任务污染)
    if (t.status === TaskStatus.RUNNING) {
      t.cancelRequested = true;
      t.errorMsg = 'Deleted by user (pending agent ack)';
      await this.repo.save(t);
      // 子任务跟随
      await this.repo.update({ parentTaskId: id }, { cancelRequested: true });
      this.logger.warn(
        `task ${id.slice(0, 8)} marked cancelRequested (was running); will be hard-deleted in 60s`,
      );
      // 注册延迟硬删 — 60s 后再清理
      setTimeout(() => {
        void this.repo
          .delete({ parentTaskId: id })
          .then(() => this.repo.delete({ id }))
          .catch(() => {});
      }, 60_000).unref?.();
      return;
    }

    // 非 running 状态可以直接删
    await this.repo.delete({ parentTaskId: id });
    await this.repo.remove(t);
  }

  async stats(tenantId?: string): Promise<{ total: number; pending: number; running: number; failed: number; done: number }> {
    const where: FindOptionsWhere<Task> = {};
    if (tenantId) where.tenantId = tenantId;
    const all = await this.repo.find({ where, take: 5000 });
    return {
      total:   all.length,
      pending: all.filter((t) => t.status === TaskStatus.PENDING).length,
      running: all.filter((t) => t.status === TaskStatus.RUNNING).length,
      failed:  all.filter((t) => t.status === TaskStatus.FAILED).length,
      done:    all.filter((t) => t.status === TaskStatus.DONE).length,
    };
  }

  /**
   * Agent 调用：原子地领取一批可执行任务（pending + scheduledAt<=now + 限定 accountId）。
   * 领取的任务立即 status=running 并设 startedAt，避免多 agent 重复执行。
   *
   * 客户端约束：
   *   - 只领自己负责的账号的任务（accountIds 列表）
   *   - 一次最多 limit 个（默认 5），避免单 agent 抢光
   *   - 每个 task 用 typeORM 乐观锁防 race
   */
  /**
   * 检查 keyword_lead_hunt 父任务: 候选人累计是否达 targetCandidates.
   * 达成 → 父 done + 剩余 pending 子任务批量标 cancelled.
   */
  async checkAndCompleteHunt(huntId: string): Promise<{ completed: boolean; reason?: string }> {
    const parent = await this.repo.findOneBy({ id: huntId });
    if (!parent || parent.type !== TaskType.KEYWORD_LEAD_HUNT) return { completed: false };
    if (parent.status === TaskStatus.DONE || parent.status === TaskStatus.FAILED) return { completed: true };

    const p = parent.payload as any ?? {};
    const target: number = p.targetCandidates ?? 0;
    if (target <= 0) return { completed: false };

    const got = await this.leadCandidates.countByHunt(huntId);
    if (got < target) return { completed: false };

    const reason = `已收集 ${got} / ${target} 候选人, 提前完成`;
    parent.status = TaskStatus.DONE;
    parent.progress = 100;
    parent.finishedAt = new Date();
    parent.errorMsg = reason;
    await this.repo.save(parent);

    await this.repo
      .createQueryBuilder()
      .update(Task)
      .set({ status: TaskStatus.FAILED, errorMsg: '上级任务目标已达, 跳过', finishedAt: new Date() })
      .where('parentTaskId = :id', { id: huntId })
      .andWhere('status = :s', { s: TaskStatus.PENDING })
      .execute();

    return { completed: true, reason };
  }

  async dispatchToAgent(accountIds: string[], limit = 5): Promise<Task[]> {
    if (!accountIds.length) return [];
    const now = new Date();

    // Healthcheck 1: 排除 quarantine 中的账号
    const quarantined = await this.accountRepo
      .createQueryBuilder('a')
      .select('a.id')
      .where('a.id IN (:...ids)', { ids: accountIds })
      .andWhere('a."quarantineUntil" IS NOT NULL AND a."quarantineUntil" > :now', { now })
      .getMany();
    const quarantinedIds = new Set(quarantined.map((a) => a.id));

    // Healthcheck 2: 排除已有 RUNNING 任务的账号（避免 over-dispatch 给 hung 客户端）
    const busy = await this.repo
      .createQueryBuilder('t')
      .select('DISTINCT t."accountId"', 'accountId')
      .where('t.status = :s', { s: TaskStatus.RUNNING })
      .andWhere('t."accountId" IN (:...ids)', { ids: accountIds })
      .getRawMany();
    const busyIds = new Set(busy.map((b) => b.accountId));

    const eligibleIds = accountIds.filter(
      (id) => !quarantinedIds.has(id) && !busyIds.has(id),
    );
    if (!eligibleIds.length) return [];

    // Codex round-3 #5: 改 PG 原生 DISTINCT ON + LIMIT, SQL 层完成去重不再全量扫描
    // 同账号一次只派 1 条, 避免 server 派多条 → agent 退回多条 → 状态抖动
    const candidates: Task[] = await this.repo.query(
      `SELECT DISTINCT ON ("accountId") *
         FROM tasks
        WHERE status = $1
          AND "scheduledAt" <= $2
          AND "accountId" = ANY($3::varchar[])
          AND type::text NOT LIKE 'preset_%'
          AND type::text != 'keyword_lead_hunt'
        ORDER BY "accountId", "scheduledAt" ASC
        LIMIT $4`,
      [TaskStatus.PENDING, now, eligibleIds, limit],
    );
    if (!candidates.length) return [];

    // keyword_lead_hunt 子任务: 派发前检查父任务目标是否已达
    // 已达 → 标父 done + 跳过所有 pending 子, 当前不派发
    const surviving: Task[] = [];
    for (const c of candidates) {
      if (c.parentTaskId) {
        const checkResult = await this.checkAndCompleteHunt(c.parentTaskId);
        if (checkResult.completed) continue;  // 父已完成, 这个子也不派发
      }
      surviving.push(c);
    }
    if (!surviving.length) return [];

    // 原子转 running
    const ids = surviving.map((c) => c.id);
    const updateRes = await this.repo
      .createQueryBuilder()
      .update(Task)
      .set({ status: TaskStatus.RUNNING, startedAt: now })
      .where('id IN (:...ids)', { ids })
      .andWhere('status = :s', { s: TaskStatus.PENDING })
      .returning('*')
      .execute();

    const dispatched = (updateRes.raw as Task[]) ?? [];
    // 子任务进入 running, 父任务汇总跟着变 (从 pending → running, 至少有 startedAt)
    const parentIds = new Set<string>();
    for (const t of dispatched) {
      if ((t as any).parentTaskId) parentIds.add((t as any).parentTaskId as string);
    }
    for (const pid of parentIds) {
      await this.recalcParentAggregate(pid).catch(() => {});
    }
    return dispatched;
  }

  /**
   * group_scrape 任务完成后自动建客户群（来自 discovered-groups「加+爬」流程）。
   * - 用 sourceGroupId + scrape startedAt 窗口找本次入库的候选人
   * - 命名: `{源群标题} ({候选数}人) · YYYY-MM-DD`
   * - 同名群存在 → append 去重
   * - 推进 discovered_groups.status: joined → scraped
   */
  private async autoGroupFromScrape(task: Task): Promise<void> {
    if (!task.tenantId) return;
    const payload = task.payload as any;
    const discoveredId: string | undefined = payload?._autoGroupFromDiscovered;
    const sourceTitle: string = payload?._autoGroupSourceTitle ?? task.name;
    const tgChatId: string | undefined = (payload?.tgChatIds ?? [])[0];
    if (!discoveredId || !tgChatId || !task.startedAt) return;

    // sourceGroupId 在 lead_candidates 里存的是 scrape 用的字符串（@username 或 -100xxx）
    const since = task.startedAt;
    const today = new Date().toISOString().slice(0, 10);
    const groupName = `${sourceTitle} · ${today}`;

    try {
      const result = await this.customerGroups.createFromScrapeWindow({
        tenantId: task.tenantId,
        name: groupName,
        description: `自动来自「群源发现」加+爬 (任务 #${task.seq})`,
        sourceGroupId: tgChatId,
        since,
      });
      if (result.created) {
        this.logger.log(`autoGroup: 新建客户群「${groupName}」共 ${result.addedCount} 人 (task #${task.seq})`);
      } else if (result.addedCount > 0) {
        this.logger.log(`autoGroup: 已有客户群「${groupName}」追加 ${result.addedCount} 人 (task #${task.seq})`);
      } else {
        this.logger.log(`autoGroup: 0 候选人，跳过建群 (task #${task.seq})`);
      }
    } catch (err) {
      this.logger.warn(`autoGroup createFromScrapeWindow failed: ${(err as Error).message}`);
    }

    // 推进 discovered_groups.status → scraped
    await this.discoveredRepo
      .update({ id: discoveredId }, { status: DiscoveredGroupStatus.SCRAPED })
      .catch(() => {});
  }
}
