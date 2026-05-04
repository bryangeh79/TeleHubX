import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KnowledgeBase } from './kb.entity';

export enum FaqSource {
  MANUAL = 'manual',
  AI_GENERATED = 'ai_generated',
  IMPORTED = 'imported',
}

@Entity('faqs')
export class Faq {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  kbId: string;

  @ManyToOne(() => KnowledgeBase, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'kbId' })
  kb: KnowledgeBase;

  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  @Column({ type: 'enum', enum: FaqSource, default: FaqSource.MANUAL })
  source: FaqSource;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @Column({ default: 0 })
  hitCount: number;

  @Column({ default: true })
  enabled: boolean;

  /**
   * i18n V1 (Issue #1): FAQ 语言.
   * zh / en / ms / vi. 默认 'zh' — 现有 FAQ 视为中文.
   * 同 KB 下可同时存在多语言 FAQ, 客户语言匹配优先, fallback 到 contentDefaultLanguage.
   */
  @Column({ type: 'varchar', length: 8, default: 'zh' })
  @Index()
  language: string;

  /**
   * i18n V1: 草稿 / 已发布. 默认 'published' — 老 FAQ 视为已发布.
   * AI 翻译生成的 FAQ 必须是 'draft', 租户审核后改 'published'.
   * BotGateway 现有 FAQ 匹配只查 published — 草稿不参与客服回复.
   */
  @Column({ type: 'varchar', length: 16, default: 'published' })
  @Index()
  status: string;

  /** 翻译来源: 若是从其他 FAQ 翻译生成的, 指向源 FAQ id (可选, 用于审计) */
  @Column({ type: 'uuid', nullable: true })
  translatedFromId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
