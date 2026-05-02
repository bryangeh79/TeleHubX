import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 通用平台级 KV 配置。
 * key 是业务标识符，value 是任意文本内容（prompt 模板等）。
 */
@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
