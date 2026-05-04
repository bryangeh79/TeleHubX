import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Task type — 22 类，对齐 WAhubX 命名习惯。
 * 每条注释包含：用途 + 主要 payload 字段 + 时长模式。
 */
export enum TaskType {
  // ── 组合配套（一键启动多日剧本）──
  /** 🎯 一键托管 14 天 = 自动养号 7 天 + 运营热身 7 天。一次启动跑 14 天后自动停。 */
  PRESET_FULL_14D    = 'preset_full_14d',
  /** 🌱 自动养号 7 天 (Day 1-7) — P0→P4 渐进。payload: { accountId } */
  PRESET_WARMUP_7D   = 'preset_warmup_7d',
  /** 🔥 运营热身 7 天 (Day 8-14) — 活跃度爬坡。payload: { accountId, intensity: 'mild'|'aggressive' } */
  PRESET_RAMPUP_7D   = 'preset_rampup_7d',
  /** 🚀 成熟运营 Day 15+ — 持续运行不限期。payload: { accountId } */
  PRESET_MATURE_OPS  = 'preset_mature_ops',

  // ── 群组发现 & 加入 ──
  /** 🌐 自动加群（邀请链接 / 群 chat_id）。payload: { inviteLinks?: [], chatIds?: [], inviteIntervalSec: [60,180] } */
  JOIN_GROUPS              = 'join_groups',
  /** 🔍 关键词搜群+加（仅加，不爬）。payload: { keywords:[], minMembers:100, maxPerDay:3 }
   *  注：盲跑命中 spam 群浪费配额。新流程建议用 DISCOVER_GROUPS_BY_KEYWORD 落库后人工挑。 */
  JOIN_GROUPS_BY_KEYWORD   = 'join_groups_by_keyword',
  /** 🔭 关键词发现群（仅搜+评估质量，不加群）。租户在 dashboard 人工挑选 → 触发现有 join+scrape。
   *  payload: { keywords:[], minMembers:50, sampleSize:100 } */
  DISCOVER_GROUPS_BY_KEYWORD = 'discover_groups_by_keyword',
  /** ⭐ Follow 频道。payload: { channels: [@username 或 invite link 列表] } */
  JOIN_CHANNELS            = 'join_channels',
  /** 👥 接受所有 pending 群组邀请。payload: { autoAcceptAll: true } */
  ACCEPT_INVITES           = 'accept_invites',

  // ── 自建群（内部沙盒） ──
  /** 🏗️ 自建测试群。payload: { title, type: 'small'|'mega', initialMemberAccountIds: [] } */
  GROUP_CREATE             = 'group_create',
  /** 📨 邀请同执行组账号入群（自建/自有/外部都可）。payload: { tgChatId|inviteLink|@username, inviterAccountId, targetAccountIds:[] } */
  GROUP_INVITE_MEMBERS     = 'group_invite_members',

  // ── 群组活动 ──
  /** 💡 群内冒泡（短句/emoji 维持活跃感）。payload: { tgChatId, count: [3,6], textPool: [] } */
  GROUP_BUBBLE             = 'group_bubble',
  /** 💬 A+B 双角色剧本。payload: { tgChatId, scriptId, accountAId, accountBId } */
  CHAT_SCRIPT_AB           = 'chat_script_ab',
  /** 💬 4 人剧本。payload: { tgChatId, scriptId, accountIds: [4 个] } */
  CHAT_SCRIPT_4P           = 'chat_script_4p',
  /** 💬 6 人剧本。payload: { tgChatId, scriptId, accountAId..accountFId } */
  CHAT_SCRIPT_6P           = 'chat_script_6p',

  // ── 拉新引流（pipeline） ──
  /** 🎯 关键词智能引流（4 阶段：搜→加→等→爬→可选触达）。默认 30 天。
   *  payload: { keywords:[], maxGroupsPerDay, scrapeDelayHours, maxOutreachPerDay, durationDays:30 } */
  KEYWORD_LEAD_HUNT        = 'keyword_lead_hunt',
  /** 🎯 群成员爬取（独立运行，不带搜群）。payload: { tgChatIds:[], maxScrapePerGroup:50 } */
  GROUP_SCRAPE             = 'group_scrape',

  // ── 触达 ──
  /** ➕ 加 contact。payload: { mode:'username'|'phone', targets:[], maxPerDay } */
  CONTACT_ADD              = 'contact_add',
  /** 📝 单条消息（campaign）。payload: { targets:[], variants:[], intervalSec:[60,300] } */
  CAMPAIGN_SINGLE          = 'campaign_single',

  // ── 内容输出 ──
  /** 📢 发频道 / Story。payload: { channelId, content, mediaAssetId? } */
  POST_CHANNEL             = 'post_channel',
  /** 🎤 发语音(从素材池随机抽)。payload: { targetType:'group'|'channel', targetId, assetCategory:'voice' } */
  MEDIA_VOICE              = 'media_voice',
  /** 🖼️ 发图片(从素材池随机抽)。payload: 同上 + assetCategory:'photo' */
  MEDIA_PHOTO              = 'media_photo',
  /** 🎬 发视频(从素材池随机抽)。payload: 同上 + assetCategory:'video' */
  MEDIA_VIDEO              = 'media_video',

  // ── 互动信号 / 保活 ──
  /** 👍 给消息加 Reaction。payload: { tgChatId, count: [10,20], emojiPool:['👍','❤️','🔥'] } */
  REACTION_BOOST           = 'reaction_boost',
  /** 🌐 浏览频道（模拟阅读）。payload: { channels:[], readDurationSec:[20,90] } */
  BROWSE_CHANNEL           = 'browse_channel',
  /** 📋 更新资料（bio/first_name/avatar）。payload: { firstName?, lastName?, bio?, photoAssetId? } */
  PROFILE_UPDATE           = 'profile_update',
  /** 🔌 挂机保活（单次）。无 payload，跑一次 account.UpdateStatus(offline:false) */
  IDLE_KEEPALIVE           = 'idle_keepalive',
}

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  DONE    = 'done',
  FAILED  = 'failed',
  PAUSED  = 'paused',
}

@Entity('tasks')
@Index(['tenantId', 'status'])
@Index(['scheduledAt'])
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 短序号 #1 #2 #3 — 比 UUID slice 友好得多, 给用户看用.
   * BIGSERIAL 自增 (PG sequence), 跨租户全局递增, 但只是展示用不参与业务唯一性.
   */
  @Column({ type: 'bigint', generated: 'increment', insert: false, update: false, nullable: true })
  seq: number;

  /**
   * preset_* 任务展开时, 子任务的 parentTaskId 指向父任务 id.
   * findAll 默认隐藏 parentTaskId IS NOT NULL 的子任务, 只列父任务,
   * 父任务详情 Modal 里展示所有子任务进度.
   */
  @Column({ type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'enum', enum: TaskType })
  type: TaskType;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PENDING })
  status: TaskStatus;

  /** Telegram account or bot record id this task targets (foreign-by-string for now). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  accountId: string | null;

  /** Display label like "@cs_account_1" — denormalized for UI listing without joins. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  accountLabel: string | null;

  /** Type-specific payload (JSON). Examples:
   *   campaign_broadcast: { campaignId, targetIds[] }
   *   warmup_browse:      { phase, durationMinutes }
   *   chat_script:        { scriptId, groupId }
   *   join_groups:        { groupLinks[] }
   */
  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'text', nullable: true })
  errorMsg: string | null;

  /**
   * 用户在 dashboard 主动取消/删除任务时设为 true。
   * Agent 会在拉任务时检查此标志：true → 跳过执行，标 status=failed
   *   errorMsg='canceled by user'。
   * 删除任务的 controller 不再立即删行，而是先 set 此 flag，
   * 1 分钟后 watchdog 才真删 — 给 agent 看到信号的时间。
   */
  @Column({ type: 'boolean', default: false })
  cancelRequested: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
