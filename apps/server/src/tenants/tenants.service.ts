import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PLAN_MAX_ACCOUNTS, Tenant, TenantPlan, TenantStatus } from './tenant.entity';

@Injectable()
export class TenantsService implements OnModuleInit {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant) private readonly repo: Repository<Tenant>,
  ) {}

  /**
   * Bootstrap a default tenant on first run so the rest of the system has
   * a tenant to attach data to. The dev-mode fallback (architecture doc
   * §2.4) of row-level tenant_id filtering uses this id everywhere until
   * full schema-per-tenant lands.
   */
  async onModuleInit(): Promise<void> {
    const existing = await this.repo.findOneBy({ name: 'default' });
    if (!existing) {
      const t = this.repo.create({
        name: 'default',
        plan: TenantPlan.BASIC,
        status: TenantStatus.ACTIVE,
        maxAccounts: PLAN_MAX_ACCOUNTS[TenantPlan.BASIC],
      });
      await this.repo.save(t);
      this.logger.log(`Bootstrapped default tenant id=${t.id}`);
    }
  }

  findAll(): Promise<Tenant[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async findOne(id: string): Promise<Tenant> {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException(`Tenant ${id} not found`);
    return t;
  }

  async getDefault(): Promise<Tenant> {
    const t = await this.repo.findOneBy({ name: 'default' });
    if (!t) throw new NotFoundException('No default tenant — bootstrap failed');
    return t;
  }

  async create(name: string, plan: TenantPlan = TenantPlan.BASIC): Promise<Tenant> {
    const t = this.repo.create({
      name,
      plan,
      status: TenantStatus.ACTIVE,
      maxAccounts: PLAN_MAX_ACCOUNTS[plan],
    });
    return this.repo.save(t);
  }

  async setLicense(
    id: string,
    licenseKey: string,
    plan: TenantPlan,
    expiresAt: Date | null,
  ): Promise<Tenant> {
    const t = await this.findOne(id);
    t.licenseKey = licenseKey;
    t.plan = plan;
    t.maxAccounts = PLAN_MAX_ACCOUNTS[plan];
    t.licenseExpiresAt = expiresAt;
    t.status = TenantStatus.ACTIVE;
    return this.repo.save(t);
  }
}
