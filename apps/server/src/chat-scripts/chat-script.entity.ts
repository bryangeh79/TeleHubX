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
