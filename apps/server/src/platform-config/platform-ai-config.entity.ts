import {
  Column, CreateDateColumn, Entity,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

/**
 * Platform-level AI provider configuration stored in DB.
 * Admin-only. AiAgentService reads this FIRST; if empty falls back to .env.
 * apiKey is stored as plain text (encrypt at rest is a Phase 2 concern).
 */
@Entity('platform_ai_configs')
export class PlatformAiConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** openai | deepseek | gemini | custom */
  @Column({ type: 'varchar', length: 20 })
  provider: string;

  /** Display name for admin UI */
  @Column({ nullable: true })
  name: string;

  @Column({ type: 'text', select: false })
  apiKey: string;

  @Column({ nullable: true })
  model: string;

  @Column({ nullable: true })
  baseUrl: string;

  /** True = this is the active platform default */
  @Column({ default: false })
  isDefault: boolean;

  /** Admin can test connection — store last test result */
  @Column({ nullable: true })
  lastTestedAt: Date;

  @Column({ type: 'varchar', length: 10, nullable: true })
  lastTestStatus: 'ok' | 'fail' | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
