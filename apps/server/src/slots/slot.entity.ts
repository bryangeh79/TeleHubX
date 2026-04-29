import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from '../accounts/account.entity';

export enum SlotStatus {
  /** No account ever assigned, OR explicitly reset — ready to accept a new bind. */
  VACANT = 'vacant',
  /** Currently held by an account. */
  OCCUPIED = 'occupied',
  /** The account that held this slot was removed; awaiting explicit "Reset to Vacant"
   *  before a new account can take this number. */
  RELEASED = 'released',
}

/**
 * Stable per-tenant ordinal for accounts. The number 1, 2, 3 ... is the
 * tenant-facing identifier ("No.1") that tasks/SOPs reference. Slot stays
 * pinned across the lifetime of the system; if its account is deleted the
 * slot moves to RELEASED and only an explicit reset returns it to VACANT.
 */
@Entity('slots')
export class Slot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  no: number;

  @Column({ type: 'enum', enum: SlotStatus, default: SlotStatus.VACANT })
  status: SlotStatus;

  /** FK to accounts.id when status=OCCUPIED. NULL otherwise. */
  @Column({ type: 'uuid', nullable: true })
  accountId: string | null;

  @OneToOne(() => Account, { onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'accountId' })
  account: Account | null;

  /** Set when an occupied account is removed. Cleared on reset. */
  @Column({ type: 'timestamptz', nullable: true })
  lastReleasedAt: Date | null;

  @Column({ nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
