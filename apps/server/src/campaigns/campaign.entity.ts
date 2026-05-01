import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export enum CampaignType {
  BROADCAST = 'broadcast',
  SEQUENTIAL = 'sequential',
}

export enum ScheduleMode {
  IMMEDIATE = 'immediate',
  ONCE = 'once',
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

export enum PacePreset {
  CONSERVATIVE = 'conservative', // 每号每天 20 条 · 3 时段
  BALANCED = 'balanced',         // 每号每天 30 条 · 3 时段
  AGGRESSIVE = 'aggressive',     // 每号每天 40 条 · 2 时段
}

export enum GreetingMode {
  FIXED = 'fixed',
  RANDOM = 'random',
  NONE = 'none',
}

export enum AccountSourceMode {
  AUTO = 'auto',
  MANUAL = 'manual',
}

export interface MessageVariant {
  text: string;
  mediaUrl?: string;
}

export const PACE_LIMITS: Record<PacePreset, { dailyLimit: number; windows: number }> = {
  conservative: { dailyLimit: 20, windows: 3 },
  balanced:     { dailyLimit: 30, windows: 3 },
  aggressive:   { dailyLimit: 40, windows: 2 },
};

/** Account aged ≥ 14 days AND healthScore ≥ 60 */
export const MATURE_DAYS = 14;
export const MATURE_MIN_HEALTH = 60;

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'enum', enum: CampaignType, default: CampaignType.BROADCAST })
  type: CampaignType;

  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  // ── Targeting ────────────────────────────────────────────────────
  /** UUIDs of CustomerGroup records */
  @Column({ type: 'simple-array', nullable: true })
  customerGroupIds: string[];

  /** Additional hand-typed tg usernames / phone numbers */
  @Column({ type: 'simple-array', nullable: true })
  targets: string[];

  // ── Content ──────────────────────────────────────────────────────
  /** UUID of AdTemplate (single-ad mode) */
  @Column({ type: 'uuid', nullable: true })
  adTemplateId: string;

  /** UUIDs of AdTemplate (multi-rotate mode) */
  @Column({ type: 'simple-array', nullable: true })
  adTemplateIds: string[];

  @Column({ type: 'jsonb', nullable: true })
  messageVariants: MessageVariant[];

  @Column({ type: 'varchar', length: 20, default: GreetingMode.RANDOM, nullable: true })
  greetingMode: GreetingMode;

  /** UUID(s) of GreetingTemplate records */
  @Column({ type: 'simple-array', nullable: true })
  greetingTemplateIds: string[];

  // ── Schedule ─────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 20, default: ScheduleMode.IMMEDIATE, nullable: true })
  scheduleMode: ScheduleMode;

  /** For ONCE/DAILY/WEEKLY — ISO datetime for first run */
  @Column({ nullable: true })
  scheduledAt: Date;

  /** HH:mm — used for DAILY / WEEKLY */
  @Column({ type: 'varchar', length: 5, nullable: true })
  scheduleTime: string;

  /** 0 = Sun … 6 = Sat — used for WEEKLY */
  @Column({ type: 'int', nullable: true })
  scheduleDayOfWeek: number;

  // ── Execution ────────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 20, default: AccountSourceMode.AUTO, nullable: true })
  accountSourceMode: AccountSourceMode;

  /** UUIDs of Account to use when accountSourceMode = manual */
  @Column({ type: 'simple-array', nullable: true })
  adAccountIds: string[];

  @Column({ type: 'varchar', length: 20, default: PacePreset.CONSERVATIVE, nullable: true })
  pacePreset: PacePreset;

  // ── Progress ─────────────────────────────────────────────────────
  @Column({ type: 'int', default: 0 })
  sentCount: number;

  @Column({ type: 'int', default: 0 })
  replyCount: number;

  /** Dispatch 时记录的总目标数量（去重后），用于 UI 进度展示 */
  @Column({ type: 'int', default: 0 })
  totalTargetCount: number;

  @Column({ nullable: true })
  completedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
