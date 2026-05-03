import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes } from 'node:crypto';
import { TenantPlan } from '../tenants/tenant.entity';
import { TenantsService } from '../tenants/tenants.service';
import { License, LicenseStatus } from './license.entity';

const PLAN_PREFIX: Record<TenantPlan, string> = {
  basic:      'BASIC',
  pro:        'PRO',
  enterprise: 'ENT',
};

const PLAN_DURATION_DAYS: Record<TenantPlan, number> = {
  basic:      365,
  pro:        365,
  enterprise: 365,
};

@Injectable()
export class LicensesService {
  private readonly logger = new Logger(LicensesService.name);
  private readonly platformSecret: string;

  constructor(
    @InjectRepository(License) private readonly repo: Repository<License>,
    private readonly tenants: TenantsService,
    private readonly config: ConfigService,
  ) {
    // Real platform would use Ed25519 from a hardware/HSM-managed secret.
    // We use HMAC-SHA256 with a server-side secret as MVP. Rotating the
    // secret invalidates all signatures (intentional escape hatch).
    this.platformSecret =
      this.config.get<string>('LICENSE_SIGNING_SECRET') ??
      this.config.get<string>('SESSION_ENCRYPTION_KEY') ??
      'telehubx-dev-secret-CHANGE-ME';
  }

  // === Signing helpers ===

  private sign(key: string): string {
    return createHmac('sha256', this.platformSecret).update(key).digest('hex');
  }

  private verify(key: string, signature: string): boolean {
    const expected = this.sign(key);
    return expected === signature;
  }

  /**
   * Format: TLHX-{PLAN}-XXXX-XXXX-XXXX-XXXX  (24 hex chars after prefix)
   * Backed by a 12-byte random read.
   */
  private generateKey(plan: TenantPlan): string {
    const buf = randomBytes(12).toString('hex').toUpperCase(); // 24 chars
    const groups = [buf.slice(0, 4), buf.slice(4, 8), buf.slice(8, 12), buf.slice(12, 16)];
    return `TLHX-${PLAN_PREFIX[plan]}-${groups.join('-')}-${buf.slice(16, 20)}-${buf.slice(20, 24)}`;
  }

  // === Issuance (admin-only path; no UI yet) ===

  async issue(plan: TenantPlan = TenantPlan.BASIC, notes?: string): Promise<License> {
    const key = this.generateKey(plan);
    const signature = this.sign(key);
    const expiresAt = new Date(
      Date.now() + PLAN_DURATION_DAYS[plan] * 24 * 60 * 60 * 1000,
    );

    const lic = this.repo.create({
      key,
      signature,
      plan,
      maxAccounts: plan === 'enterprise' ? 50 : plan === 'pro' ? 30 : 10,
      status: LicenseStatus.PENDING,
      expiresAt,
      notes,
    });
    return this.repo.save(lic);
  }

  list(): Promise<License[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  // === Activation (the path tenants actually use) ===

  /**
   * Validate a license key and bind it to a tenant. Idempotent:
   * - If the key isn't known → 404
   * - If signature doesn't match → 400
   * - If already active and bound to a different tenant → 409
   * - If active and bound to same tenant → no-op return
   */
  async activate(
    key: string,
    machineId?: string,
    targetTenantName: string = 'default',
  ): Promise<{ license: License; tenant: { id: string; name: string; plan: string; maxAccounts: number } }> {
    const lic = await this.repo.findOneBy({ key });
    if (!lic) throw new NotFoundException('License key not found');
    if (!this.verify(lic.key, lic.signature)) {
      throw new BadRequestException('License signature invalid (key or signing secret tampered)');
    }
    if (lic.status === LicenseStatus.REVOKED) {
      throw new BadRequestException('License revoked');
    }
    if (lic.expiresAt && lic.expiresAt.getTime() < Date.now()) {
      lic.status = LicenseStatus.EXPIRED;
      await this.repo.save(lic);
      throw new BadRequestException('License expired');
    }

    // Bind to tenant (default tenant unless caller specifies)
    let tenant = await this.tenants
      .findAll()
      .then((all) => all.find((t) => t.name === targetTenantName));
    if (!tenant) {
      tenant = await this.tenants.create(targetTenantName, lic.plan);
    }

    if (lic.status === LicenseStatus.ACTIVE && lic.tenantId && lic.tenantId !== tenant.id) {
      throw new ConflictException('License already activated by a different tenant');
    }

    lic.status = LicenseStatus.ACTIVE;
    lic.tenantId = tenant.id;
    lic.activatedAt = new Date();
    if (machineId) lic.machineId = machineId;
    await this.repo.save(lic);

    await this.tenants.setLicense(tenant.id, lic.key, lic.plan, lic.expiresAt);

    this.logger.log(`License ${lic.key.slice(0, 16)}... activated for tenant=${tenant.name} plan=${lic.plan}`);

    return {
      license: lic,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: lic.plan,
        maxAccounts: lic.maxAccounts,
      },
    };
  }

  /** Lightweight read used by ActivatePage to decide what to show. */
  async status(): Promise<{ activated: boolean; tenant?: any; license?: any }> {
    const active = await this.repo.findOne({
      where: { status: LicenseStatus.ACTIVE },
      order: { activatedAt: 'DESC' },
    });
    if (!active) return { activated: false };
    const tenant = active.tenantId ? await this.tenants.findOne(active.tenantId) : null;
    return {
      activated: true,
      license: {
        keyMasked: `${active.key.slice(0, 12)}...${active.key.slice(-4)}`,
        plan: active.plan,
        status: active.status,
        expiresAt: active.expiresAt,
        activatedAt: active.activatedAt,
      },
      tenant,
    };
  }

  async revoke(id: string): Promise<License> {
    const lic = await this.repo.findOneBy({ id });
    if (!lic) throw new NotFoundException(`License ${id} not found`);
    lic.status = LicenseStatus.REVOKED;
    return this.repo.save(lic);
  }

  /** SUPER_ADMIN: 列出所有 license */
  findAll(): Promise<License[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  /** 列出某租户的所有 license（含历史 revoked / expired） */
  findByTenant(tenantId: string): Promise<License[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }
}
