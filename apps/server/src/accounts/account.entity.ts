import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AccountRole {
  CS = 'cs',
  AD = 'ad',
  HYBRID = 'hybrid',
}

export enum AccountStatus {
  OFFLINE = 'offline',
  ONLINE = 'online',
  CONNECTING = 'connecting',
  ERROR = 'error',
  BANNED = 'banned',
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  phoneNumber: string;

  @Exclude({ toPlainOnly: true })
  @Column({ nullable: true, select: false })
  sessionString: string;

  /** Inline proxy config — legacy/manual entry path. Prefer proxyId reference below. */
  @Column({ type: 'jsonb', nullable: true })
  proxyConfig: ProxyConfig;

  /** FK to proxies.id when tenant picked a pre-configured proxy from the catalog. */
  @Column({ type: 'uuid', nullable: true })
  proxyId: string | null;

  @Column({ type: 'enum', enum: AccountRole, default: AccountRole.CS })
  role: AccountRole;

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.OFFLINE })
  status: AccountStatus;

  @Column({ default: 0 })
  warmupPhase: number;

  @Column({ type: 'int', default: 100 })
  healthScore: number;

  @Column({ nullable: true })
  lastActiveAt: Date;

  @Column({ nullable: true })
  boundIp: string;

  @Column({ default: false })
  sessionEncrypted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
