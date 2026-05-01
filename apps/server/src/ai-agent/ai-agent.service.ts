import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
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

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  /** Cached OpenAI clients keyed by `${providerId}:${apiKeyHash}`. Lazy. */
  private readonly clients = new Map<string, OpenAI>();

  /** Default provider id (from AI_PROVIDER env, fallback openai). */
  private readonly defaultProviderId: AiProviderId;

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
   * Priority for provider id: dto.provider > AI_PROVIDER env > 'openai'.
   * Priority for API key: provider-specific env (OPENAI_API_KEY etc) >
   *                       generic AI_API_KEY.
   * Priority for model: dto.model > AI_MODEL env > provider's defaultModel.
   * Priority for baseUrl: AI_BASE_URL env > provider's baseUrl.
   */
  private resolve(providerOverride?: AiProviderId, modelOverride?: string): ResolvedProvider {
    const id: AiProviderId = providerOverride ?? this.defaultProviderId;
    const cfg = AI_PROVIDERS[id];

    const apiKey =
      this.config.get<string>(cfg.keyEnv) ||
      this.config.get<string>('AI_API_KEY') ||
      '';

    if (!apiKey) {
      throw new ServiceUnavailableException(
        `AI provider '${id}' not configured. Set ${cfg.keyEnv} (or AI_API_KEY) in environment.`,
      );
    }

    const baseUrl =
      this.config.get<string>('AI_BASE_URL') || cfg.baseUrl;

    const model =
      modelOverride ||
      this.config.get<string>('AI_MODEL') ||
      cfg.defaultModel;

    return { id, config: cfg, apiKey, baseUrl, model };
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
    const key = `${CONV_KEY_PREFIX}${dto.chatId}`;
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

  async clearHistory(chatId: string): Promise<{ ok: boolean }> {
    await this.redis.del(`${CONV_KEY_PREFIX}${chatId}`);
    return { ok: true };
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
    const provider = this.resolve();
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
