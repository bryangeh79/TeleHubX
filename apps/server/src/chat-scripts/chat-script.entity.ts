import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ChatScriptType {
  AB = 'A+B',
  ABCD = 'A+B+C+D',
}

export enum ChatScriptStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export interface ScriptLine {
  roleLabel: 'A' | 'B' | 'C' | 'D';
  text: string;
  allowEmoji: boolean;
  delayAfterMs: number;
  delayStdDevMs: number;
}

@Entity('chat_scripts')
export class ChatScript {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  tenantId: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ChatScriptType })
  type: ChatScriptType;

  @Column({ type: 'int' })
  minRound: number;

  @Column({ type: 'int' })
  maxRound: number;

  @Column({ type: 'simple-array', nullable: true })
  groupIds: string[];

  @Column({ type: 'simple-array', nullable: true })
  accountIds: string[];

  @Column({ type: 'jsonb' })
  lines: ScriptLine[];

  /** 来源 pack id（builtin 包导入时填，租户自建为 null）。 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  packId: string | null;

  /** 分类标签：daily_greeting / morning_weather / business_inquiry 等。 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  category: string | null;

  /**
   * 完整 WAhubX 风格 script blob（保留 content_pool / asset_pool 等多变体字段）。
   * executor 运行时从 pool 随机抽，达到"一剧本 N 种执行"的反检测效果。
   * 为 null 表示这是一个简单的固定文案脚本（lines 字段就是全部）。
   */
  @Column({ type: 'jsonb', nullable: true })
  rawScript: any | null;

  @Column({ type: 'enum', enum: ChatScriptStatus, default: ChatScriptStatus.DRAFT })
  status: ChatScriptStatus;

  @Column({ type: 'int', default: 0 })
  executedCount: number;

  @Column({ nullable: true })
  lastExecutedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
