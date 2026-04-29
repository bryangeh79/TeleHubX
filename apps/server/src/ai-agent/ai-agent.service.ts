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

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
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
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly logger = new Logger(AiAgentService.name);
  private readonly configured: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY', '');
    this.configured = Boolean(apiKey);
    this.model = this.config.get<string>('OPENAI_MODEL', 'gpt-4o-mini');
    if (this.configured) {
      this.client = new OpenAI({
        apiKey,
        baseURL: this.config.get<string>('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      });
    } else {
      this.client = null;
      this.logger.warn('OPENAI_API_KEY not set — AI endpoints will return 503 until configured');
    }
  }

  private ensureConfigured(): OpenAI {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'AI provider not configured. Set OPENAI_API_KEY in environment.',
      );
    }
    return this.client;
  }

  private translateUpstreamError(err: unknown): never {
    const e = err as { status?: number; code?: string; message?: string };
    const status = e?.status;
    const code = e?.code;
    const msg = e?.message ?? 'AI provider request failed';
    this.logger.error(`AI upstream error status=${status} code=${code} message=${msg}`);

    if (status === 401 || status === 403 || code === 'invalid_api_key') {
      throw new ServiceUnavailableException(
        'AI provider authentication failed. Check OPENAI_API_KEY validity.',
      );
    }
    if (status === 429 || code === 'insufficient_quota' || code === 'rate_limit_exceeded') {
      throw new ServiceUnavailableException(
        'AI provider rate limit or quota exceeded.',
      );
    }
    throw new BadGatewayException('AI provider returned an error.');
  }

  async reply(dto: AiReplyDto): Promise<{ reply: string; tokens: number }> {
    const client = this.ensureConfigured();
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
        model: this.model,
        messages,
        max_tokens: 512,
        temperature: 0.7,
      });
    } catch (err) {
      this.translateUpstreamError(err);
    }

    const assistantReply = completion.choices[0]?.message?.content ?? '';
    const tokens = completion.usage?.total_tokens ?? 0;

    const updatedHistory: ConversationMessage[] = ([
      ...history,
      { role: 'user' as const, content: dto.userMessage },
      { role: 'assistant' as const, content: assistantReply },
    ] as ConversationMessage[]).slice(-MAX_HISTORY);

    await this.saveHistory(key, updatedHistory);
    this.logger.log(`reply chatId=${dto.chatId} tokens=${tokens}`);

    return { reply: assistantReply, tokens };
  }

  async faq(dto: AiFaqDto): Promise<{ answer: string; tokens: number }> {
    const client = this.ensureConfigured();
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
        model: this.model,
        messages,
        max_tokens: 200,
        temperature: 0.3,
      });
    } catch (err) {
      this.translateUpstreamError(err);
    }

    const answer = completion.choices[0]?.message?.content ?? '';
    const tokens = completion.usage?.total_tokens ?? 0;

    return { answer, tokens };
  }

  async clearHistory(chatId: string): Promise<{ ok: boolean }> {
    await this.redis.del(`${CONV_KEY_PREFIX}${chatId}`);
    return { ok: true };
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
