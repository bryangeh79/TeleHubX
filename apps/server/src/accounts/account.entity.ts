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

  /**
   * TG 数字 user id，绑号成功后从 client.getMe() 拿。
   * 用作「自己人白名单」: AutoReplyDecider 判断 incoming msg.from.id
   * 是否属于本租户已绑账号集合，避免自我循环（A 给 B 发剧本 → B 触发 FAQ → A 触发 FAQ）。
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  tgUserId: string | null;

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

  /**
   * 隔离截至时间 — FloodWait / 风控触发时设置，到期前所有 task 跳过此号。
   * null 或过去时间 = 不在隔离期，可正常派单。
   */
  @Column({ type: 'timestamptz', nullable: true })
  quarantineUntil: Date | null;

  /** 隔离原因（用于诊断） */
  @Column({ type: 'varchar', length: 256, nullable: true })
  quarantineReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
