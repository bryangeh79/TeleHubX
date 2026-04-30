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

  /** FK to execution_groups.id; null = ungrouped. Max 6 accounts per group. */
  @Column({ type: 'uuid', nullable: true })
  executionGroupId: string | null;

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

  /**
   * 设备指纹快照 (deviceModel / systemVersion / appVersion / langCode / systemLangCode)。
   * 创建账号时确定，**永不变更** — 改了会让 Telegram 视为"换设备登录"，触发安全告警。
   * 重连/重启都用这个指纹，跨进程一致。
   */
  @Column({ type: 'jsonb', nullable: true })
  deviceFingerprint: Record<string, string> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
