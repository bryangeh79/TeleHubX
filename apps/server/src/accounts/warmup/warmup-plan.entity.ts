import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../account.entity';

export interface WarmupActionLog {
  phase: number;
  action: string;
  ts: string;
}

@Entity('warmup_plans')
export class WarmupPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  accountId: string;

  @OneToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: Account;

  @Column({ type: 'int', default: 0 })
  currentPhase: number;

  @Column({ type: 'jsonb', nullable: true })
  phaseStartedAt: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  actionsLog: WarmupActionLog[];

  @Column({ default: false })
  completed: boolean;

  @Column({ default: false })
  paused: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  pausedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
