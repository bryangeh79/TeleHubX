import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { deriveKey, encryptSession, decryptSession } from '../crypto/session-crypto.util';
import { PLAN_MAX_ACCOUNTS, Tenant, TenantPlan, TenantStatus } from './tenant.entity';
import { TenantBot } from './tenant-bot.entity';
import { CreateTenantBotDto, UpdateTenantBotDto } from './tenant-bot.dto';
import { ReplyMode, TenantAiProvider, TenantSettings } from './tenant-settings.entity';
import { UpdateTenantSettingsDto } from './tenant-settings.dto';

export interface EffectiveAiConfig {
  source: 'tenant' | 'platform';
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: 'openai' | 'deepseek' | 'gemini' | 'custom';
}

const PROVIDER_DEFAULTS: Record<TenantAiProvider, { baseUrl: string; model: string }> = {
  [TenantAiProvider.OPENAI]:   { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  [TenantAiProvider.DEEPSEEK]: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  [TenantAiProvider.GEMINI]:   { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  [TenantAiProvider.CUSTOM]:   { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

@Injectable()
export class TenantsService implements OnModuleInit {
  private readonly logger = new Logger(TenantsService.name);
  private encKey: Buffer | null = null;

  constructor(
    @InjectRepository(Tenant) private readonly repo: Repository<Tenant>,
    @InjectRepository(TenantBot) private readonly botRepo: Repository<TenantBot>,
    @InjectRepository(TenantSettings) private readonly settingsRepo: Repository<TenantSettings>,
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

  // ── Settings (per-tenant CS config) ──────────────────────────────────────

  async getSettings(tenantId: string): Promise<TenantSettings> {
    let s = await this.settingsRepo.findOneBy({ tenantId });
    if (!s) {
      await this.findOne(tenantId);
      s = this.settingsRepo.create({ tenantId, replyMode: ReplyMode.SMART });
      s = await this.settingsRepo.save(s);
    }
    return s;
  }

  async updateSettings(tenantId: string, dto: UpdateTenantSettingsDto): Promise<TenantSettings> {
    const s = await this.getSettingsWithKey(tenantId);

    // Smart 模式：要求租户已配置自有 key（优先）或平台有兜底 key
    if (dto.replyMode === ReplyMode.SMART) {
      const tenantKeyAfter = dto.tenantAiApiKey ?? (s.tenantAiKeyEncrypted ? '<existing>' : '');
      if (!tenantKeyAfter && !this.hasPlatformAiKey()) {
        throw new BadRequestException(
          '启用 AI 智能模式需要：① 租户在「AI Settings」配置自有 API Key，或 ② 平台 .env 配置 PLATFORM_OPENAI_API_KEY 等兜底 key。',
        );
      }
    }

    // 租户 API key 加密处理
    if (dto.tenantAiApiKey !== undefined) {
      if (!dto.tenantAiApiKey) {
        s.tenantAiKeyEncrypted = null;
      } else {
        if (!this.encKey) throw new BadRequestException('SESSION_ENCRYPTION_KEY not configured');
        s.tenantAiKeyEncrypted = encryptSession(dto.tenantAiApiKey, this.encKey);
      }
    }

    const { tenantAiApiKey: _omit, ...rest } = dto;
    Object.assign(s, rest);
    const saved = await this.settingsRepo.save(s);
    // Strip encrypted key from response
    const { tenantAiKeyEncrypted: _strip, ...safe } = saved;
    return safe as TenantSettings;
  }

  /** Read settings WITH the encrypted key column (for internal use). */
  async getSettingsWithKey(tenantId: string): Promise<TenantSettings> {
    const existing = await this.settingsRepo
      .createQueryBuilder('s')
      .addSelect('s.tenantAiKeyEncrypted')
      .where('s.tenantId = :tenantId', { tenantId })
      .getOne();
    if (existing) return existing;
    return this.getSettings(tenantId);
  }

  /**
   * Returns the effective AI config for runtime use:
   *   - tenant key if the tenant has configured one
   *   - else platform fallback (.env PLATFORM_*)
   *   - else null (caller decides whether to error)
   */
  async getEffectiveAiConfig(tenantId: string): Promise<EffectiveAiConfig | null> {
    const s = await this.getSettingsWithKey(tenantId);
    if (s.tenantAiKeyEncrypted && this.encKey && s.tenantAiProvider) {
      let plain: string;
      try {
        plain = decryptSession(s.tenantAiKeyEncrypted, this.encKey);
      } catch {
        this.logger.warn(`Failed to decrypt tenant AI key for tenant=${tenantId}`);
        plain = '';
      }
      if (plain) {
        const def = PROVIDER_DEFAULTS[s.tenantAiProvider];
        return {
          source: 'tenant',
          apiKey: plain,
          baseUrl: s.tenantAiBaseUrl || def.baseUrl,
          model: s.tenantAiModel || def.model,
          provider: s.tenantAiProvider,
        };
      }
    }
    // Platform fallback
    return this.getPlatformAiConfig();
  }

  getPlatformAiConfig(): EffectiveAiConfig | null {
    const openai = this.config.get<string>('PLATFORM_OPENAI_API_KEY') || this.config.get<string>('OPENAI_API_KEY');
    const deepseek = this.config.get<string>('PLATFORM_DEEPSEEK_API_KEY') || this.config.get<string>('DEEPSEEK_API_KEY');
    const gemini = this.config.get<string>('PLATFORM_GEMINI_API_KEY') || this.config.get<string>('GEMINI_API_KEY');
    const apiKey = openai || deepseek || gemini;
    if (!apiKey) return null;

    const provider: 'openai' | 'deepseek' | 'gemini' = openai ? 'openai' : deepseek ? 'deepseek' : 'gemini';
    const baseUrl = this.config.get<string>('PLATFORM_AI_BASE_URL')
      || this.config.get<string>('AI_BASE_URL')
      || (provider === 'deepseek' ? 'https://api.deepseek.com'
        : provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/openai'
        : 'https://api.openai.com/v1');
    const model = this.config.get<string>('PLATFORM_AI_MODEL')
      || this.config.get<string>('AI_MODEL')
      || (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
    return { source: 'platform', apiKey, baseUrl, model, provider };
  }

  private hasPlatformAiKey(): boolean {
    return Boolean(this.getPlatformAiConfig());
  }
}
