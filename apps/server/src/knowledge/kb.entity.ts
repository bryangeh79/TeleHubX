import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Seven-category model from telehubx_full_plan §10.1.
 * Each KB is a logical bucket; FAQs below live inside a KB.
 */
export enum KbType {
  PRODUCT = 'product',           // 产品资料
  PRICING = 'pricing',           // 价格 / 套餐
  PRESALES_FAQ = 'presales_faq', // 售前 FAQ
  SUPPORT_FAQ = 'support_faq',   // 售后 FAQ
  COMPANY = 'company',           // 公司介绍
  AD_MATERIAL = 'ad_material',   // 广告素材
  GUARDRAIL = 'guardrail',       // 风控 / 禁答规则
}

@Entity('knowledge_bases')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: KbType, default: KbType.PRESALES_FAQ })
  type: KbType;

  @Column({ nullable: true })
  description: string;

  /**
   * AI 回复时的终极目标。会被拼入 system prompt。
   * 例：「让客户了解本公司的服务和联系方式，引导咨询或预约」
   */
  @Column({ type: 'text', nullable: true })
  goalPrompt: string | null;

  /** 公司通用 KB 标记。每个 tenant 至多一个 isDefault=true。 */
  @Column({ default: false })
  isDefault: boolean;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
