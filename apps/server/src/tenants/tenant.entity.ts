import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TenantPlan {
  BASIC = 'basic',           // 10 accounts
  PRO = 'pro',               // 30 accounts
  ENTERPRISE = 'enterprise', // 50 accounts
}

export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  EXPIRED = 'expired',
}

export const PLAN_MAX_ACCOUNTS: Record<TenantPlan, number> = {
  [TenantPlan.BASIC]: 10,
  [TenantPlan.PRO]: 30,
  [TenantPlan.ENTERPRISE]: 50,
};

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  schemaName: string;

  @Column({ type: 'enum', enum: TenantPlan, default: TenantPlan.BASIC })
  plan: TenantPlan;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.ACTIVE })
  status: TenantStatus;

  @Column({ type: 'int', default: 10 })
  maxAccounts: number;

  @Column({ nullable: true })
  licenseKey: string;

  @Column({ type: 'timestamptz', nullable: true })
  licenseExpiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
