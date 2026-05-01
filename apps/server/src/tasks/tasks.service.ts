import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { Account } from '../accounts/account.entity';
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
  return new Date(day.getTime() + spanMs * g);
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
  ) {}

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
      dto.type === TaskType.PRESET_MATURE_OPS
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
    }

    // 先创建父任务 (待运行状态作为"主任务"展示, 子任务进度反推父任务进度)
    const parent = await this.repo.save(this.repo.create({
      ...dto,
      scheduledAt: start,
      tenantId: tenantId ?? null,
      status: TaskStatus.PENDING,
      progress: 0,
    }));

    // 再创建子任务 + 链接 parentTaskId
    let savedCount = 0;
    for (const s of subs) {
      const sub = this.repo.create({
        name: s.name,
        type: s.type,
        accountId: dto.accountId ?? '',
        accountLabel: dto.accountLabel ?? null,
        payload: s.payload,
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
          payload: { keywords, minMembers: 100, maxPerDay: 1 },
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

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const t = await this.findOne(id);
    if (dto.scheduledAt) {
      t.scheduledAt = new Date(dto.scheduledAt);
    }
    if (dto.name !== undefined) t.name = dto.name;
    if (dto.status !== undefined) t.status = dto.status;
    if (dto.payload !== undefined) t.payload = dto.payload;
    if (dto.progress !== undefined) t.progress = dto.progress;
    if (dto.errorMsg !== undefined) t.errorMsg = dto.errorMsg;
    return this.repo.save(t);
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
    t.status = TaskStatus.FAILED;
    t.errorMsg = 'Cancelled by user';
    t.finishedAt = new Date();
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
      .set({ status: TaskStatus.FAILED, errorMsg: 'Cancelled (bulk stop)', finishedAt: new Date() })
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
    return this.repo.save(t);
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
    const t = await this.findOne(id);
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
  async dispatchToAgent(accountIds: string[], limit = 5): Promise<Task[]> {
    if (!accountIds.length) return [];
    const now = new Date();
    const candidates = await this.repo
      .createQueryBuilder('t')
      .where('t.status = :s', { s: TaskStatus.PENDING })
      .andWhere('t."scheduledAt" <= :now', { now })
      .andWhere('t."accountId" IN (:...ids)', { ids: accountIds })
      // 排除 preset_* 父任务: 它们是配方编排器, 不是 agent 执行的单点任务
      .andWhere(`t.type::text NOT LIKE 'preset_%'`)
      .orderBy('t."scheduledAt"', 'ASC')
      .limit(limit)
      .getMany();

    if (!candidates.length) return [];

    // 原子转 running
    const ids = candidates.map((c) => c.id);
    const updateRes = await this.repo
      .createQueryBuilder()
      .update(Task)
      .set({ status: TaskStatus.RUNNING, startedAt: now })
      .where('id IN (:...ids)', { ids })
      .andWhere('status = :s', { s: TaskStatus.PENDING })
      .returning('*')
      .execute();

    return (updateRes.raw as Task[]) ?? [];
  }
}
