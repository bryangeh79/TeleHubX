import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TestGroupSource {
  /** 系统帮租户创建的群（GROUP_CREATE 任务产物） */
  SELF_BUILT = 'self_built',
  /** 租户在 TG 自己手动建的群，把我们某号设为 admin 后录入 */
  EXTERNAL_OWNED = 'external_owned',
  /** 公开第三方群（@username 加入，不是我们的）— 用于 ChatScript 的"演给路人看" */
  EXTERNAL_PUBLIC = 'external_public',
}

export enum TestGroupKind {
  /** messages.CreateChat — ≤ 200 人 */
  SMALL = 'small',
  /** channels.CreateChannel(megagroup=true) — 无人数限制 */
  MEGA = 'mega',
}

/**
 * 租户在系统里管理的群组列表 — 用于 ChatScript / GroupBubble 等任务的"目标场所"。
 *
 * 三种来源：
 *   1. 系统创建（自建测试群，跑剧本用）
 *   2. 租户自己创建后录入（admin 邀请我们的号入群）
 *   3. 公开外部群（仅作为"陪跑"目标，跑 BUBBLE 让账号"看起来活跃"）
 */
@Entity('tenant_test_groups')
@Index(['tenantId', 'executionGroupId'])
export class TenantTestGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  /** 哪个执行组别在用这个群。null = 全 tenant 共享 */
  @Column({ type: 'uuid', nullable: true })
  executionGroupId: string | null;

  @Column({ type: 'enum', enum: TestGroupSource })
  source: TestGroupSource;

  @Column({ type: 'enum', enum: TestGroupKind, default: TestGroupKind.SMALL })
  kind: TestGroupKind;

  /** TG 那边的 chat_id (megagroup 是负数, small chat 是负数; 用 string 存兼容大数) */
  @Column({ type: 'varchar', length: 64 })
  tgChatId: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  /** 公开群可能有 username, 私密自建群没有 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  /** 群主 / 创建者账号 ID — 自建群必填 */
  @Column({ type: 'uuid', nullable: true })
  ownerAccountId: string | null;

  @Column({ type: 'int', default: 0 })
  memberCount: number;

  /** 租户这边记录"系统的哪些号在群里"（同步 GROUP_INVITE_MEMBERS 后更新） */
  @Column({ type: 'simple-array', nullable: true })
  systemMemberAccountIds: string[];

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
