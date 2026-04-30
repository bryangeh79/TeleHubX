import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum CandidateStatus {
  /** 刚爬到，还没联系 */
  PENDING = 'pending',
  /** 已经联系过（CONTACT_ADD / CAMPAIGN_SINGLE 已发） */
  CONTACTED = 'contacted',
  /** 对方回过我们 → 应该已经升级成 Lead */
  REPLIED = 'replied',
  /** 已转成 Lead（主表 leads 里有对应记录） */
  CONVERTED = 'converted',
  /** 黑名单（不可达/不要联系/已被举报）*/
  BLOCKED = 'blocked',
  /** 30 天联系无回应，自动归档 */
  EXPIRED = 'expired',
}

/**
 * 候选人池 — 通过群成员爬取 / 关键词智能引流 / 手动导入收集来的潜在客户。
 *
 * 与 leads 表的区别：
 *   - leads = 已经主动联系过我们的人（通过 Bot 发了消息），有完整对话历史
 *   - lead_candidates = 我们想去主动联系的人，还没建立对话
 *   - 候选 → 联系 → 对方回复 → 自动转 lead（converted）
 */
@Entity('lead_candidates')
@Unique(['tenantId', 'tgUserId'])
@Index(['tenantId', 'status'])
@Index(['sourceGroupId'])
export class LeadCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /** TG 用户 ID（数字，用 string 兼容大数） */
  @Column({ type: 'varchar', length: 32 })
  tgUserId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tgUsername: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  lastName: string | null;

  /** 从哪个群爬到的（TG chat_id），用于追溯效果 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceGroupId: string | null;

  /** 哪个号爬到这个人（用于跨号去重 — 同执行组别其他号别再去联系）*/
  @Column({ type: 'uuid', nullable: true })
  scrapedByAccountId: string | null;

  @Column({ type: 'timestamptz' })
  scrapedAt: Date;

  /** 排序优先级 0-100，候选池满时优先取高分。
   *  真人特征加分（最近活跃 / 有头像 / 不是 Premium / 用户名规整等）。*/
  @Column({ type: 'int', default: 50 })
  priorityScore: number;

  @Column({ type: 'enum', enum: CandidateStatus, default: CandidateStatus.PENDING })
  status: CandidateStatus;

  /** 哪个号联系了这个人 */
  @Column({ type: 'uuid', nullable: true })
  contactedByAccountId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  contactedAt: Date | null;

  /** 已发送的开场白 task id（追溯效果） */
  @Column({ type: 'uuid', nullable: true })
  contactTaskId: string | null;

  /** 升级后对应的 leads.id */
  @Column({ type: 'uuid', nullable: true })
  convertedLeadId: string | null;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
