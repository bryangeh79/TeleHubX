import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LeadIntent {
  COLD = 'cold',
  WARM = 'warm',
  HOT = 'hot',
}

export enum LeadStatus {
  NEW = 'new',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  CONVERTED = 'converted',
  CLOSED = 'closed',
}

export interface LeadReply {
  text: string;
  sentBy: 'system' | 'human';
  ts: string;
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  tgUsername: string;

  @Column()
  tgUserId: string;

  @Column({ nullable: true })
  campaignId: string;

  @Column({ nullable: true })
  product: string;

  @Column({ nullable: true })
  budget: string;

  @Column({ type: 'enum', enum: LeadIntent, default: LeadIntent.COLD })
  intent: LeadIntent;

  @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.NEW })
  status: LeadStatus;

  @Column({ nullable: true })
  assignedCsAccountId: string;

  @Column({ default: false })
  needsHuman: boolean;

  @Column({ type: 'simple-array', nullable: true })
  notes: string[];

  @Column({ type: 'jsonb', nullable: true })
  replies: LeadReply[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
