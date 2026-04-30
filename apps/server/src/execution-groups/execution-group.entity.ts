import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export const MAX_MEMBERS_PER_GROUP = 6;

/**
 * 执行组别 — 把账号划分到 1..N 组，每组最多 6 个号；
 * 系统按组别错开任务时间，避免广告号扎堆触发风控。
 */
@Entity('execution_groups')
@Unique(['tenantId', 'slotNum'])
@Index(['tenantId'])
export class ExecutionGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  /** 1-based 组别编号（1..9） */
  @Column({ type: 'int' })
  slotNum: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
