import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReplyMode {
  /** 关闭：所有回复人工处理 */
  OFF = 'off',
  /** FAQ 模式：只匹配 FAQ，不命中转人工，不调 AI */
  FAQ = 'faq',
  /** AI 智能 + FAQ：FAQ 优先，不命中时调 AI 兜底（需要 AI key） */
  SMART = 'smart',
}

@Entity('tenant_settings')
export class TenantSettings {
  @PrimaryColumn({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'enum', enum: ReplyMode, default: ReplyMode.SMART })
  replyMode: ReplyMode;

  @Column({ type: 'int', default: 50 })
  dailyReplyLimit: number;

  @Column({ default: false })
  quietHoursEnabled: boolean;

  @Column({ type: 'varchar', length: 5, default: '22:00' })
  quietHoursStart: string;

  @Column({ type: 'varchar', length: 5, default: '08:00' })
  quietHoursEnd: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
