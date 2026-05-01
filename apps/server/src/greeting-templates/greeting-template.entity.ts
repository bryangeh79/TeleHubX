import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('greeting_templates')
export class GreetingTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  text: string;

  /** Category for filtering: e.g. '礼貌', '好奇', '优惠' */
  @Column({ nullable: true })
  category: string;

  /** AI quality score 1-10; populated by AI scoring job */
  @Column({ type: 'int', nullable: true })
  aiScore: number;

  /** How many AI variants generated from this text */
  @Column({ type: 'int', default: 0 })
  aiVariantCount: number;

  /** AI-generated variants: array of { text } */
  @Column({ type: 'jsonb', nullable: true })
  variants: Array<{ text: string }>;

  @Column({ default: false })
  aiVariantEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
