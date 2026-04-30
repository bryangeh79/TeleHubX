import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
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

export enum LeadTakeover {
  /** AI handles inbound DMs. Default. */
  AI = 'ai',
  /** Human operator has taken over — AI must NOT reply. */
  HUMAN = 'human',
  /** Conversation closed (resolved). AI ignores. */
  CLOSED = 'closed',
  /** Do Not Reply — permanent block. */
  DNR = 'dnr',
}

export interface LeadReply {
  text: string;
  /** 'user' = customer inbound, 'system' = bot/AI auto-reply, 'human' = operator manual reply */
  sentBy: 'system' | 'human' | 'user';
  ts: string;
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  tgUsername: string;

  @Index()
  @Column()
  tgUserId: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

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

  @Column({ type: 'enum', enum: LeadTakeover, default: LeadTakeover.AI })
  takeoverState: LeadTakeover;

  @Column({ nullable: true })
  takenOverBy: string;

  @Column({ type: 'timestamptz', nullable: true })
  takenOverAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
