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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
