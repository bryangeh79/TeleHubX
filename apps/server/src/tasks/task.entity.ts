import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Task type covering all Wave 4+ scheduled actions. Front-end SchedulerPage drives this enum. */
export enum TaskType {
  CAMPAIGN_BROADCAST = 'campaign_broadcast', // 广告群发
  CAMPAIGN_SINGLE    = 'campaign_single',    // 单条消息
  WARMUP_BROWSE      = 'warmup_browse',      // 养号·浏览
  WARMUP_POST        = 'warmup_post',        // 养号·发帖
  CHAT_SCRIPT        = 'chat_script',        // 群剧本
  JOIN_GROUPS        = 'join_groups',        // 加群
  JOIN_CHANNELS      = 'join_channels',      // 加频道
  REACTION_BOOST     = 'reaction_boost',     // 加 Reaction
  IDLE_KEEPALIVE     = 'idle_keepalive',     // keepalive
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
