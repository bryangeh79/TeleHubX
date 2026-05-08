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
import { GreetingTemplate } from '../greeting-templates/greeting-template.entity';

/** 平台默认开场白样本 — 新租户自动种入 */
const DEFAULT_GREETINGS: Array<{ category: string; text: string }> = [
  { category: '礼貌', text: '你好，打扰您一下 👋' },
  { category: '优惠', text: '您好，新客户可以先免费试用 7 天，不满意零成本退出。看要不要先体验一下？' },
  { category: '热情', text: '您好呀！今天天气真不错 ☀️ 想跟您分享个好东西，绝对不会让您失望' },
  { category: '专业', text: '您好，我们是 XX 平台的官方合作伙伴，专门做 XX 业务。看您应该用得上，简单介绍一下？' },
];

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
    @InjectRepository(GreetingTemplate) private readonly greetingRepo: Repository<GreetingTemplate>,
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
    // vmfix8 (Issue #14): if schema bootstrap (TYPEORM_SYNC) didn't create
    // the tenants table, surface a structured error rather than crashing
    // bootstrap with a raw QueryFailedError. The installer ships with
    // TYPEORM_SYNC=true (set by supervisor's subprocessEnv) so this path
    // should not normally fire.
    let tenant: import('./tenant.entity').Tenant | null = null;
    try {
      tenant = await this.repo.findOneBy({ name: 'default' });
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = (err as Error).message ?? '';
      if (code === '42P01' || /relation "tenants" does not exist/i.test(message)) {
        this.logger.error(
          'tenants table missing — schema bootstrap (TYPEORM_SYNC) did not run. ' +
          'For installer mode set TYPEORM_SYNC=true. Skipping default tenant seed.',
        );
        return;  // do not crash; let server boot so /health + /settings/license still work
      }
      throw err;
    }
    if (!tenant) {
      tenant = await this.repo.save(this.repo.create({
        name: 'default',
        plan: TenantPlan.BASIC,
        status: TenantStatus.ACTIVE,
        maxAccounts: PLAN_MAX_ACCOUNTS[TenantPlan.BASIC],
      }));
      this.logger.log(`Bootstrapped default tenant id=${tenant.id}`);
    }
    try {
      await this.seedDefaultGreetings(tenant.id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '42P01') {
        this.logger.warn('greeting_templates table missing — skipping greeting seed');
        return;
      }
      throw err;
    }
  }

  /** 给租户种入平台默认开场白（已存在则跳过，幂等安全） */
  private async seedDefaultGreetings(tenantId: string): Promise<void> {
    const existing = await this.greetingRepo.find({ where: { tenantId } });
    const existingTexts = new Set(existing.map(g => g.text));
    const toCreate = DEFAULT_GREETINGS.filter(s => !existingTexts.has(s.text));
    if (!toCreate.length) return;
    const records = toCreate.map(s => this.greetingRepo.create({ tenantId, ...s }));
    await this.greetingRepo.save(records);
    this.logger.log(`Seeded ${records.length} default greetings for tenant=${tenantId}`);
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
    const saved = await this.repo.save(t);
    // 新租户自动种入平台默认开场白
    await this.seedDefaultGreetings(saved.id);
    return saved;
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

  /** SUPER_ADMIN: 暂停租户（账号都标 banned 等效，前端看不到操作权） */
  async suspend(id: string, reason?: string): Promise<Tenant> {
    const t = await this.findOne(id);
    t.status = TenantStatus.SUSPENDED;
    return this.repo.save(t);
  }

  /** SUPER_ADMIN: 恢复租户 */
  async resume(id: string): Promise<Tenant> {
    const t = await this.findOne(id);
    t.status = TenantStatus.ACTIVE;
    return this.repo.save(t);
  }

  async update(id: string, patch: Partial<Pick<Tenant, 'name' | 'plan' | 'maxAccounts'>>): Promise<Tenant> {
    const t = await this.findOne(id);
    if (patch.name) t.name = patch.name;
    if (patch.plan) {
      t.plan = patch.plan;
      t.maxAccounts = patch.maxAccounts ?? PLAN_MAX_ACCOUNTS[patch.plan];
    } else if (patch.maxAccounts !== undefined) {
      t.maxAccounts = patch.maxAccounts;
    }
    return this.repo.save(t);
  }

  async remove(id: string): Promise<void> {
    const t = await this.findOne(id);
    if (t.name === 'default') {
      throw new BadRequestException('cannot delete default tenant');
    }
    await this.repo.remove(t);
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

  /** 取该租户当前 active 的 bot（含 rawToken）。多个时返回最新创建的。 */
  async findActiveBotByTenantWithToken(tenantId: string): Promise<(TenantBot & { rawToken: string }) | null> {
    if (!this.encKey) return null;
    const bot = await this.botRepo
      .createQueryBuilder('b')
      .addSelect('b.tokenEncrypted')
      .where('b.tenantId = :tenantId AND b.isActive = true', { tenantId })
      .orderBy('b.createdAt', 'DESC')
      .getOne();
    if (!bot) return null;
    try {
      const rawToken = decryptSession(bot.tokenEncrypted, this.encKey);
      return Object.assign(bot, { rawToken });
    } catch {
      return null;
    }
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
