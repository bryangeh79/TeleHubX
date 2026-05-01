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

  /** Main ad text */
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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
