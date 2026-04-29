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

  @Column()
  name: string;

  @Column({ type: 'enum', enum: KbType, default: KbType.PRESALES_FAQ })
  type: KbType;

  @Column({ nullable: true })
  description: string;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
