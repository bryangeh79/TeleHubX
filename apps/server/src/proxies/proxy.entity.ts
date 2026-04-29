import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProxyType {
  SOCKS5 = 'socks5',
  SOCKS4 = 'socks4',
  HTTP = 'http',
  HTTPS = 'https',
  MTPROTO = 'mtproto',
  OPENVPN = 'openvpn',
}

export enum ProxyStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
  DEAD = 'dead',
}

@Entity('proxies')
export class Proxy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Friendly label so tenants pick by name in BindWizard. Unique. */
  @Column({ unique: true })
  name: string;

  @Column({ type: 'enum', enum: ProxyType, default: ProxyType.SOCKS5 })
  type: ProxyType;

  @Column()
  host: string;

  @Column({ type: 'int' })
  port: number;

  @Column({ nullable: true })
  username: string;

  /** Stored encrypted at rest like sessionString — never serialized to API. */
  @Exclude({ toPlainOnly: true })
  @Column({ nullable: true, select: false })
  password: string;

  @Column({ default: false })
  passwordEncrypted: boolean;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  isp: string;

  @Column({ type: 'enum', enum: ProxyStatus, default: ProxyStatus.ACTIVE })
  status: ProxyStatus;

  @Column({ nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
