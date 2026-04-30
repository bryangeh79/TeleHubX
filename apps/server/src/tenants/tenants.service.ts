import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { deriveKey, encryptSession, decryptSession } from '../crypto/session-crypto.util';
import { PLAN_MAX_ACCOUNTS, Tenant, TenantPlan, TenantStatus } from './tenant.entity';
import { TenantBot } from './tenant-bot.entity';
import { CreateTenantBotDto, UpdateTenantBotDto } from './tenant-bot.dto';

@Injectable()
export class TenantsService implements OnModuleInit {
  private readonly logger = new Logger(TenantsService.name);
  private encKey: Buffer | null = null;

  constructor(
    @InjectRepository(Tenant) private readonly repo: Repository<Tenant>,
    @InjectRepository(TenantBot) private readonly botRepo: Repository<TenantBot>,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('SESSION_ENCRYPTION_KEY');
    this.encKey = raw ? deriveKey(raw) : null;
  }

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

  // ── Bot CRUD ────────────────────────────────────────────────────────────────

  async createBot(tenantId: string, dto: CreateTenantBotDto, botUsername: string): Promise<TenantBot> {
    await this.findOne(tenantId);
    if (!this.encKey) throw new BadRequestException('SESSION_ENCRYPTION_KEY not configured');
    const tokenEncrypted = encryptSession(dto.token, this.encKey);
    const bot = this.botRepo.create({ tenantId, botUsername, tokenEncrypted });
    return this.botRepo.save(bot);
  }

  listBots(tenantId: string): Promise<TenantBot[]> {
    return this.botRepo.find({ where: { tenantId }, order: { createdAt: 'ASC' } });
  }

  async findBot(botId: string): Promise<TenantBot> {
    const bot = await this.botRepo.findOneBy({ id: botId });
    if (!bot) throw new NotFoundException(`TenantBot ${botId} not found`);
    return bot;
  }

  async findBotWithToken(botId: string): Promise<TenantBot & { rawToken: string }> {
    const bot = await this.botRepo
      .createQueryBuilder('b')
      .addSelect('b.tokenEncrypted')
      .where('b.id = :id', { id: botId })
      .getOne();
    if (!bot) throw new NotFoundException(`TenantBot ${botId} not found`);
    if (!this.encKey) throw new BadRequestException('SESSION_ENCRYPTION_KEY not configured');
    const rawToken = decryptSession(bot.tokenEncrypted, this.encKey);
    return Object.assign(bot, { rawToken });
  }

  async findActiveBotsWithTokens(): Promise<Array<TenantBot & { rawToken: string }>> {
    if (!this.encKey) return [];
    const bots = await this.botRepo
      .createQueryBuilder('b')
      .addSelect('b.tokenEncrypted')
      .where('b.isActive = true')
      .getMany();
    return bots.map((b) => {
      try {
        const rawToken = decryptSession(b.tokenEncrypted, this.encKey!);
        return Object.assign(b, { rawToken });
      } catch {
        this.logger.warn(`Failed to decrypt token for bot ${b.id}, skipping`);
        return null;
      }
    }).filter(Boolean) as Array<TenantBot & { rawToken: string }>;
  }

  async updateBot(tenantId: string, botId: string, dto: UpdateTenantBotDto): Promise<TenantBot> {
    const bot = await this.findBot(botId);
    if (bot.tenantId !== tenantId) throw new NotFoundException(`TenantBot ${botId} not found`);
    if (dto.isActive !== undefined) bot.isActive = dto.isActive;
    if (dto.botUsername !== undefined) bot.botUsername = dto.botUsername;
    return this.botRepo.save(bot);
  }

  async removeBot(tenantId: string, botId: string): Promise<void> {
    const bot = await this.findBot(botId);
    if (bot.tenantId !== tenantId) throw new NotFoundException(`TenantBot ${botId} not found`);
    await this.botRepo.remove(bot);
  }

  async updateBotOffset(botId: string, offset: number): Promise<void> {
    await this.botRepo.update(botId, { pollingOffset: offset, lastPollAt: new Date() });
  }

  async updateBotError(botId: string, error: string | null): Promise<void> {
    await this.botRepo.update(botId, { lastError: error });
  }

  async setBotActive(botId: string, isActive: boolean): Promise<void> {
    await this.botRepo.update(botId, { isActive });
  }
}
