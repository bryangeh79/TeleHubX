import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantPlan } from '../tenants/tenant.entity';

export enum LicenseStatus {
  PENDING = 'pending',     // generated, not activated yet
  ACTIVE = 'active',       // activated and bound to a tenant
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('licenses')
export class License {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Public license key string (e.g. "TLHX-PRO-XXXX-XXXX-XXXX-XXXX") */
  @Column({ unique: true })
  key: string;

  /** HMAC-SHA256 signature of the key (signed by platform secret) */
  @Column()
  signature: string;

  @Column({ type: 'enum', enum: TenantPlan, default: TenantPlan.BASIC })
  plan: TenantPlan;

  @Column({ type: 'int', default: 10 })
  maxAccounts: number;

  @Column({ type: 'enum', enum: LicenseStatus, default: LicenseStatus.PENDING })
  status: LicenseStatus;

  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  /** Optional machine fingerprint binding (set on activation). */
  @Column({ nullable: true })
  machineId: string;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ nullable: true })
  notes: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
