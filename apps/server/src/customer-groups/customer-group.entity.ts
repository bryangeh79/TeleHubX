import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 成员来源类型 */
export type MemberSource =
  | 'manual'        // 手动粘贴
  | 'excel'         // Excel/CSV 导入
  | 'lead_hunt'     // 关键词智能引流
  | 'group_scrape'  // 群成员爬取
  | 'contacts'      // 从 TG 联系人
  | 'pool_filter';  // 候选池筛选

/** 成员明细：与 members[] 同长度，按 index 对应 */
export interface MemberDetail {
  value: string;            // 与 members[i] 相同
  source: MemberSource;
  addedAt: string;          // ISO datetime
  /** 引流类来源任务 id，方便溯源 */
  huntTaskId?: string;
  /** TG 元数据，候选池来的有 */
  tgUserId?: string;
  tgUsername?: string;
  isPremium?: boolean;
}

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

  /** 成员值数组 (phone / @username / tgUserId / link)，campaigns 直接读这个 */
  @Column({ type: 'simple-array', nullable: true })
  members: string[];

  /** 富 metadata，与 members[] 按 index 对齐 */
  @Column({ type: 'jsonb', nullable: true })
  memberDetails: MemberDetail[];

  /** Snapshot count — refreshed on save */
  @Column({ type: 'int', default: 0 })
  memberCount: number;

  /** 此群被多少个 campaign 引用 */
  @Column({ type: 'int', default: 0 })
  usedCount: number;

  /** 最近被使用时间（最后一次入队广告） */
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  /** 标签，用于过滤分类 */
  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
