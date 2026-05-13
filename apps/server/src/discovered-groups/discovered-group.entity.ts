import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DiscoveredGroupKind {
  MEGA = 'mega',
  CHANNEL = 'channel',
  BASIC = 'basic',
  GIGAGROUP = 'gigagroup',
}

export enum DiscoveredGroupStatus {
  /** 新发现，未处理 */
  NEW = 'new',
  /** 已派发 join 任务 */
  JOINED = 'joined',
  /** 已派发 scrape 任务 + 入库候选人 */
  SCRAPED = 'scraped',
  /** 租户标记忽略（spam / 不感兴趣） */
  IGNORED = 'ignored',
}

/**
 * vmfix28 #2: 群被发现的来源 — 哪条路径找到的，让 UI 能 tag 区分。
 */
export enum DiscoverSource {
  /** 通过 TG `contacts.Search` 找到（按群名 + username 匹配） */
  CONTACTS_SEARCH = 'contacts',
  /** 通过 TG `messages.searchGlobal` 找到（按消息内容匹配） */
  SEARCH_GLOBAL = 'global',
  /** 通过 `discover_groups_by_invites` 任务从种子群抓邀请链接 resolve 到的 */
  INVITE_HARVEST = 'invite_harvest',
  /** vmfix29 A5/A6/A7: 通过滚雪球（forwarded 源 / user.about / GetCommonChats）发现的 */
  SNOWBALL = 'snowball',
}

/**
 * 关键词搜群任务发现的群源池。租户在 dashboard 看到列表 + 质量评分，
 * 人工挑选高质量群 → 触发现有 join_groups + group_scrape 任务链。
 */
@Entity('discovered_groups')
@Index('IDX_DG_TENANT_QUALITY', ['tenantId', 'qualityScore'])
@Index('UQ_DG_TENANT_CHATID', ['tenantId', 'tgChatId'], { unique: true })
export class DiscoveredGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  /** TG numerical chat id（megagroup/channel 是负数 -100..., basic chat 是负数, 前端展示一律字符串） */
  @Column({ type: 'varchar', length: 64 })
  tgChatId: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  tgUsername: string | null;

  @Column({ type: 'varchar', length: 256 })
  title: string;

  @Column({ type: 'enum', enum: DiscoveredGroupKind })
  kind: DiscoveredGroupKind;

  /** GetFullChannel 返回的真实成员数；-1 = 未查到 */
  @Column({ type: 'int', default: -1 })
  participantsCount: number;

  /** TG 的 gigagroup 标记（≥20 万成员，非 admin 不能 list 全部成员） */
  @Column({ default: false })
  isGigagroup: boolean;

  /** 抽样历史消息中是否检测到真用户发言（false = 全 anonymous broadcast，无引流价值） */
  @Column({ default: false })
  hasRealSenders: boolean;

  /** 抽样消息总数 */
  @Column({ type: 'int', default: 0 })
  sampledMessages: number;

  /** 抽样里 unique 真用户发言者数 */
  @Column({ type: 'int', default: 0 })
  sampledRealSenders: number;

  /** 触发发现的关键词 */
  @Column({ type: 'varchar', length: 256, nullable: true })
  keyword: string | null;

  /** 哪个账号发现的（agent 跑 discover task 时记录） */
  @Column({ type: 'uuid', nullable: true })
  discoveredByAccountId: string | null;

  /** 关联的 discover 任务 id */
  @Column({ type: 'uuid', nullable: true })
  discoverTaskId: string | null;

  @Column({ type: 'enum', enum: DiscoveredGroupStatus, default: DiscoveredGroupStatus.NEW })
  status: DiscoveredGroupStatus;

  /** 0-100 综合评分（计算见 service.computeQuality） */
  @Column({ type: 'int', default: 0 })
  qualityScore: number;

  /**
   * vmfix28 #2: 群被发现的来源（contacts.Search / messages.searchGlobal / invite_harvest）。
   * 老数据 default='contacts'。前端按值给不同颜色 tag。
   */
  @Column({ type: 'enum', enum: DiscoverSource, default: DiscoverSource.CONTACTS_SEARCH })
  discoverSource: DiscoverSource;

  /**
   * vmfix28 B2: AI 给的目标客户匹配度评分（0-100）。
   * null = 未跑 AI 评分（任务 payload 没开 aiScore=true）.
   */
  @Column({ type: 'int', nullable: true })
  aiScore: number | null;

  /** vmfix28 B2: AI 评分理由（短文本，≤120 字） */
  @Column({ type: 'varchar', length: 256, nullable: true })
  aiReason: string | null;

  /**
   * vmfix28 B4: 抽样消息里"最近 7 天消息数 / 总抽样数" × 100 (0-100)。
   * ≥50 时前端打 🔥 HOT tag，service.computeQuality 也额外加 +5 分.
   */
  @Column({ type: 'int', default: 0 })
  recentMessageRate: number;

  /**
   * vmfix29 NEW-1: queueScrape 派发时记录哪个账号被分配执行 join+scrape.
   * 群源发现 UI 在 status='joined'/'scraped' 时显示这个号，让用户能追溯哪个号去加了.
   */
  @Column({ type: 'uuid', nullable: true })
  dispatchedToAccountId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  dispatchedToAccountLabel: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
