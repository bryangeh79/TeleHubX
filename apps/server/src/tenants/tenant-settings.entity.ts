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

export enum TenantAiProvider {
  OPENAI = 'openai',
  DEEPSEEK = 'deepseek',
  GEMINI = 'gemini',
  CUSTOM = 'custom',
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

  // ── 租户自有 AI 配置（用于 customer chat，cost 由租户承担）──
  // 留空时：smart 模式仍可用，但 AiAgentService 会回落到 PLATFORM_* env 配置；
  // 公司不愿提供时可强制 smart 模式必须填写（updateSettings 已校验）。

  @Column({ type: 'enum', enum: TenantAiProvider, nullable: true })
  tenantAiProvider: TenantAiProvider | null;

  /** AES-256-GCM 加密的租户自有 API key */
  @Column({ type: 'text', nullable: true, select: false })
  tenantAiKeyEncrypted: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  tenantAiModel: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  tenantAiBaseUrl: string | null;

  /** 执行组别数量 (2-9)。修改后系统会重排所有组的任务时间。 */
  @Column({ type: 'int', default: 0 })
  groupCount: number;

  /**
   * 人工接管 operator 列表。触发 handoff 时 Bot 会并发推送通知给所有 enabled=true 的 chatId。
   * Operator 必须先主动给 Bot 发过 /start，否则 TG 拒绝推送。
   */
  @Column({ type: 'jsonb', nullable: true, default: () => "'[]'::jsonb" })
  humanAgents: Array<{ chatId: string; name?: string; enabled: boolean }> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
