import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('customer_groups')
export class CustomerGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  /** 'manual' = hand-typed numbers; 'candidates' = from lead_candidates pool */
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  sourceType: 'manual' | 'candidates';

  /** Stored targets: tg usernames / chat ids / phone numbers */
  @Column({ type: 'simple-array', nullable: true })
  members: string[];

  /** Snapshot count — refreshed on save */
  @Column({ type: 'int', default: 0 })
  memberCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
