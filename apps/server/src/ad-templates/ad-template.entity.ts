import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('ad_templates')
export class AdTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  /** Original ad text — the base copy */
  @Column({ type: 'text' })
  content: string;

  /** Whether a media asset is attached */
  @Column({ default: false })
  hasMedia: boolean;

  /** UUID of asset from assets table */
  @Column({ type: 'uuid', nullable: true })
  mediaAssetId: string;

  /** Tags for quick filtering */
  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  /** AI-generated variants: array of { text: string } */
  @Column({ type: 'jsonb', nullable: true })
  variants: Array<{ text: string }>;

  /** Whether AI variant pool is enabled */
  @Column({ default: false })
  aiVariantEnabled: boolean;

  /** Whether this template is active / shown in wizard */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
