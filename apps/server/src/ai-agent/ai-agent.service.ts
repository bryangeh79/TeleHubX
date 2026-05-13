import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import OpenAI from 'openai';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { AiReplyDto } from './dto/ai-reply.dto';
import { AiFaqDto } from './dto/ai-faq.dto';
import {
  AI_PROVIDERS,
  AiProviderConfig,
  AiProviderId,
  isAiProviderId,
} from './ai-providers';

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ResolvedProvider {
  id: AiProviderId;
  config: AiProviderConfig;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface RuntimeAiOverride {
  /** Already-decrypted API key (tenant-owned or platform fallback) */
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Provider hint for logging/error mapping */
  provider?: AiProviderId;
}

const CONV_TTL_SECONDS = 86400;
const CONV_KEY_PREFIX = 'ai:conv:';
const MAX_HISTORY = 20;

const DEFAULT_CS_SYSTEM = `You are a professional customer service assistant for a business.
Be helpful, concise, and friendly. Answer questions about products and services.
If unsure, acknowledge politely and offer to connect the customer with a human.`;

const DEFAULT_FAQ_SYSTEM = `You are a helpful assistant that answers frequently asked questions briefly and clearly.
Keep responses under 100 words. Be direct and factual.`;

/** Lazy-loaded to avoid circular dependency — injected after module init */
export interface IPlatformConfigService {
  getDefaultProvider(): Promise<{ provider: string; apiKey: string; model?: string; baseUrl?: string } | null>;
}

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  /** Cached OpenAI clients keyed by `${providerId}:${apiKeyHash}`. Lazy. */
  private readonly clients = new Map<string, OpenAI>();

  /** Default provider id (from AI_PROVIDER env, fallback openai). */
  private readonly defaultProviderId: AiProviderId;

  /** Injected lazily to avoid circular dependency — set by PlatformConfigModule */
  platformConfigService?: IPlatformConfigService;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const raw = this.config.get<string>('AI_PROVIDER', 'openai');
    this.defaultProviderId = isAiProviderId(raw) ? raw : 'openai';
    if (!isAiProviderId(raw)) {
      this.logger.warn(
        `Unknown AI_PROVIDER='${raw}', falling back to 'openai'. Valid: openai|deepseek|gemini`,
      );
    }
    this.logger.log(`Default AI provider: ${this.defaultProviderId}`);
  }

  /**
   * Resolve which provider to use for this call.
   * Priority: providerOverride param > DB platform config > .env > 'openai' defaults.
   */
  private resolve(providerOverride?: AiProviderId, modelOverride?: string): ResolvedProvider {
    const id: AiProviderId = providerOverride ?? this.defaultProviderId;
    const cfg = AI_PROVIDERS[id] ?? AI_PROVIDERS['openai'];

    const apiKey =
      this.config.get<string>(cfg.keyEnv) ||
      this.config.get<string>('AI_API_KEY') ||
      '';

    if (!apiKey) {
      throw new ServiceUnavailableException(
        `AI provider '${id}' not configured. Set ${cfg.keyEnv} (or AI_API_KEY) in .env, or add a platform config in the dashboard.`,
      );
    }

    const baseUrl = this.config.get<string>('AI_BASE_URL') || cfg.baseUrl;
    const model = modelOverride || this.config.get<string>('AI_MODEL') || cfg.defaultModel;

    return { id, config: cfg, apiKey, baseUrl, model };
  }

  /**
   * Resolve platform config from DB first, then fall back to .env.
   * Used by internal tasks (variant generation, scoring, etc.)
   */
  async resolvePlatform(modelOverride?: string): Promise<ResolvedProvider> {
    // Try DB config first
    if (this.platformConfigService) {
      try {
        const dbCfg = await this.platformConfigService.getDefaultProvider();
        if (dbCfg?.apiKey) {
          const providerId = isAiProviderId(dbCfg.provider) ? dbCfg.provider : 'openai';
          const cfg = AI_PROVIDERS[providerId];
          return {
            id: providerId,
            config: cfg,
            apiKey: dbCfg.apiKey,
            baseUrl: dbCfg.baseUrl || cfg.baseUrl,
            model: modelOverride || dbCfg.model || cfg.defaultModel,
          };
        }
      } catch {
        // DB not ready, fall through to .env
      }
    }
    // Fallback to .env
    return this.resolve(undefined, modelOverride);
  }

  private getClient(p: ResolvedProvider): OpenAI {
    // cache by provider id + first 8 of key (so rotating key doesn't reuse stale client)
    const cacheKey = `${p.id}:${p.apiKey.slice(0, 8)}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new OpenAI({ apiKey: p.apiKey, baseURL: p.baseUrl });
      this.clients.set(cacheKey, client);
    }
    return client;
  }

  private translateUpstreamError(err: unknown, providerId: AiProviderId): never {
    const e = err as { status?: number; code?: string; message?: string };
    const status = e?.status;
    const code = e?.code;
    const msg = e?.message ?? 'AI provider request failed';
    this.logger.error(`AI upstream error provider=${providerId} status=${status} code=${code} message=${msg}`);

    if (status === 401 || status === 403 || code === 'invalid_api_key') {
      throw new ServiceUnavailableException(
        `AI provider '${providerId}' authentication failed. Check ${AI_PROVIDERS[providerId].keyEnv} validity.`,
      );
    }
    if (status === 429 || code === 'insufficient_quota' || code === 'rate_limit_exceeded') {
      throw new ServiceUnavailableException(
        `AI provider '${providerId}' rate limit or quota exceeded.`,
      );
    }
    throw new BadGatewayException(`AI provider '${providerId}' returned an error.`);
  }

  /** Public: list provider availability + which is active by default. */
  info(): {
    defaultProvider: AiProviderId;
    providers: Array<{
      id: AiProviderId;
      label: string;
      configured: boolean;
      keyEnv: string;
      defaultModel: string;
    }>;
  } {
    return {
      defaultProvider: this.defaultProviderId,
      providers: Object.values(AI_PROVIDERS).map((cfg) => ({
        id: cfg.id,
        label: cfg.label,
        configured:
          Boolean(this.config.get<string>(cfg.keyEnv)) ||
          Boolean(this.config.get<string>('AI_API_KEY')),
        keyEnv: cfg.keyEnv,
        defaultModel: cfg.defaultModel,
      })),
    };
  }

  async reply(
    dto: AiReplyDto,
    override?: RuntimeAiOverride,
    /** Codex round-10 #2: 多租户/多 bot 隔离的 conv key context. 不传走 legacy key (向后兼容). */
    scope?: { tenantId?: string; botId?: string },
  ): Promise<{ reply: string; tokens: number; provider: AiProviderId; model: string }> {
    let provider: ResolvedProvider;
    if (override) {
      const id: AiProviderId = override.provider ?? 'openai';
      provider = {
        id,
        config: AI_PROVIDERS[id],
        apiKey: override.apiKey,
        baseUrl: override.baseUrl,
        model: override.model,
      };
    } else {
      provider = this.resolve(dto.provider, dto.model);
    }
    const client = this.getClient(provider);
    // Codex round-10 #2: 同 chatId 在不同租户/不同 bot 的对话历史不能串线
    // 推荐: ai:conv:{tenantId}:{botId}:{chatId}; legacy 仅保留兼容老调用
    const key = scope?.tenantId
      ? `${CONV_KEY_PREFIX}${scope.tenantId}:${scope.botId ?? 'default'}:${dto.chatId}`
      : `${CONV_KEY_PREFIX}${dto.chatId}`;
    const history = await this.loadHistory(key);

    const systemPrompt = dto.systemPrompt ?? DEFAULT_CS_SYSTEM;
    const messages: ConversationMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: dto.userMessage },
    ];

    let completion;
    try {
      completion = await client.chat.completions.create({
        model: provider.model,
        messages,
        max_tokens: 512,
        temperature: 0.7,
      });
    } catch (err) {
      this.translateUpstreamError(err, provider.id);
    }

    const assistantReply = completion.choices[0]?.message?.content ?? '';
    const tokens = completion.usage?.total_tokens ?? 0;

    const updatedHistory: ConversationMessage[] = ([
      ...history,
      { role: 'user' as const, content: dto.userMessage },
      { role: 'assistant' as const, content: assistantReply },
    ] as ConversationMessage[]).slice(-MAX_HISTORY);

    await this.saveHistory(key, updatedHistory);
    this.logger.log(
      `reply chatId=${dto.chatId} provider=${provider.id} model=${provider.model} tokens=${tokens}`,
    );

    return { reply: assistantReply, tokens, provider: provider.id, model: provider.model };
  }

  async faq(
    dto: AiFaqDto,
  ): Promise<{ answer: string; tokens: number; provider: AiProviderId; model: string }> {
    const provider = this.resolve(dto.provider, dto.model);
    const client = this.getClient(provider);
    const messages: ConversationMessage[] = [
      { role: 'system', content: DEFAULT_FAQ_SYSTEM },
    ];

    if (dto.context) {
      messages.push({ role: 'system', content: `Context: ${dto.context}` });
    }

    messages.push({ role: 'user', content: dto.question });

    let completion;
    try {
      completion = await client.chat.completions.create({
        model: provider.model,
        messages,
        max_tokens: 200,
        temperature: 0.3,
      });
    } catch (err) {
      this.translateUpstreamError(err, provider.id);
    }

    const answer = completion.choices[0]?.message?.content ?? '';
    const tokens = completion.usage?.total_tokens ?? 0;

    return { answer, tokens, provider: provider.id, model: provider.model };
  }

  /** Codex round-10 #2: 推荐传 scope 用新 key 删除; 不传走 legacy 删除 */
  async clearHistory(chatId: string, scope?: { tenantId?: string; botId?: string }): Promise<{ ok: boolean }> {
    const key = scope?.tenantId
      ? `${CONV_KEY_PREFIX}${scope.tenantId}:${scope.botId ?? 'default'}:${chatId}`
      : `${CONV_KEY_PREFIX}${chatId}`;
    await this.redis.del(key);
    return { ok: true };
  }

  /**
   * vmfix27 #A3: 关键词扩展。
   * 输入：用户原始关键词（如 "健康 马来西亚"）
   * 输出：5-10 个语义变体（中英马混合 + 地名细分 + 同义词），用于
   * `discover_groups_by_keyword` 并发搜，命中率从单 keyword 30% 提升到 85%+。
   *
   * 优雅退化：AI 不可用时返回 [原始 keyword]，调用方继续单 keyword 搜索。
   */
  async expandKeywords(opts: {
    keyword: string;
    maxVariants?: number;
    targetLanguages?: string[];   // 默认 ['zh', 'en', 'ms', 'vi']
  }): Promise<{ variants: string[]; fromAi: boolean }> {
    const original = opts.keyword.trim();
    if (!original) return { variants: [], fromAi: false };
    const max = opts.maxVariants ?? 8;
    const langs = (opts.targetLanguages ?? ['zh', 'en', 'ms', 'vi']).join(', ');

    // vmfix29.1: 强化 SEA 区域语言覆盖，TG 用户基数 SEA 占大头
    const system = `你是 Telegram 群组搜索关键词优化专家，目标用户在东南亚（马来西亚、新加坡、印尼、越南、泰国、菲律宾、柬埔寨）。
任务：把用户输入的关键词扩展成 ${max} 个 Telegram 公开群上有较大命中概率的搜索变体。

规则（重要性递减）：
1. **强烈优先**生成 SEA 本地语言变体：
   - 中文（简繁混合 / 含港式 / 含台式）
   - 英文（含 Singlish / Malaysian English 缩写如 "MY"/"SG"）
   - 马来语 (Bahasa Melayu，如 "Loteri"/"Sukan"/"Kesihatan")
   - 越南语 (Tiếng Việt，如 "Bóng đá"/"Cá độ"/"Làm đẹp")
   - 印尼语 (Bahasa Indonesia，如 "Togel"/"Sepak bola"/"Kecantikan")
   - 泰语关键词（用拉丁字母拼写形式，如 "Bangkok"/"Phuket" 等）
2. 优先给地名细分：马来 → KL / Penang / JB / Ipoh; 新加坡; 印尼 → Jakarta / Surabaya / Bandung; 越南 → HCM / Hanoi; 泰国 → BKK / Phuket
3. 包括同义词 / 行业俗语 / 缩写
4. 保留原始关键词作为第一个
5. 每个变体 1-4 个词
6. 只返回纯 JSON 数组，不要任何前后缀

示例输入: "健康 马来西亚"
示例输出: ["健康 马来西亚","Health Malaysia","Kesihatan MY","KL wellness","Penang 健康","JB health","养生 马来","Slimming Malaysia","Beauty wellness SG","Healthy lifestyle KL"]`;

    const user = original;

    try {
      const raw = await this.complete({
        system,
        user,
        maxTokens: 400,
        temperature: 0.7,
      });
      // 尝试解析 JSON 数组
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) throw new Error('no JSON array in response');
      const arr = JSON.parse(m[0]);
      if (!Array.isArray(arr)) throw new Error('not an array');
      const variants = arr
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 64);
      // 去重 + 把原始 keyword 放第一位
      const seen = new Set<string>();
      const out: string[] = [];
      out.push(original);
      seen.add(original.toLowerCase());
      for (const v of variants) {
        if (seen.has(v.toLowerCase())) continue;
        seen.add(v.toLowerCase());
        out.push(v);
        if (out.length >= max) break;
      }
      return { variants: out, fromAi: true };
    } catch (err: any) {
      this.logger.warn(`expandKeywords fallback (AI unavailable): ${err?.message ?? err}`);
      return { variants: [original], fromAi: false };
    }
  }

  /**
   * vmfix27 #B2: 用 AI 给单个群打质量分（0-100）。
   * 输入：群 title + description + 抽样消息片段 + 租户目标客户画像
   * 输出：匹配度分数 + 理由（短文本）
   *
   * 优雅退化：AI 不可用时返回 null，调用方继续用结构化 quality score.
   */
  async scoreGroupMatch(opts: {
    groupTitle: string;
    groupDescription?: string;
    sampleMessages?: string[];
    targetAudience: string;  // 来自 tenant_settings.targetAudience 或类似
  }): Promise<{ score: number; reason: string } | null> {
    const system = `你是 Telegram 营销目标客户匹配评估师。任务：根据群信息判断此群是否匹配租户的目标客户画像，返回 0-100 分。
规则：
- 100: 群成员就是目标客户，匹配完美
- 70-90: 群高度相关，多数成员可能是潜在客户
- 40-70: 群部分相关，需进一步筛选
- 10-40: 群低相关，可能小部分潜在客户
- 0-10: 群完全无关或负面（如同行竞品群）
返回纯 JSON：{"score": <0-100>, "reason": "<10-30 字简短理由>"}`;
    const sampleText = (opts.sampleMessages ?? []).slice(0, 5).map((m) => `- ${m.slice(0, 80)}`).join('\n');
    const user = `目标客户: ${opts.targetAudience}

群名: ${opts.groupTitle}
群简介: ${opts.groupDescription ?? '(无)'}
群内最近消息样本:
${sampleText || '(无样本)'}`;
    try {
      const raw = await this.complete({ system, user, maxTokens: 150, temperature: 0.3 });
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no JSON object');
      const obj = JSON.parse(m[0]);
      const score = Math.max(0, Math.min(100, Number(obj.score) || 0));
      const reason = String(obj.reason ?? '').slice(0, 120);
      return { score, reason };
    } catch (err: any) {
      this.logger.warn(`scoreGroupMatch fallback (AI unavailable): ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Simple one-shot completion using platform AI key (no history, no Redis).
   * For internal tasks: variant generation, greeting scoring, etc.
   */
  async complete(opts: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<string> {
    const provider = await this.resolvePlatform();
    const client = this.getClient(provider);
    let completion: any;
    try {
      completion = await client.chat.completions.create({
        model: provider.model,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 2000,
        temperature: opts.temperature ?? 0.8,
      });
    } catch (err) {
      this.translateUpstreamError(err, provider.id);
    }
    return completion.choices[0]?.message?.content ?? '';
  }

  private async loadHistory(key: string): Promise<ConversationMessage[]> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as ConversationMessage[]) : [];
    } catch {
      return [];
    }
  }

  private async saveHistory(key: string, messages: ConversationMessage[]): Promise<void> {
    await this.redis.set(key, JSON.stringify(messages), 'EX', CONV_TTL_SECONDS);
  }
}
