import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { ContextStore } from './context-store';
import { TemplateService } from './template.service';
import { logger } from '../logger';

export type AiProvider = 'openai' | 'deepseek' | 'gemini' | 'claude' | 'custom';

export interface AiReplyConfig {
  provider: AiProvider;
  apiKey: string;
  // Custom base URL for DeepSeek, Gemini OpenAI-compat, or any custom endpoint
  baseUrl?: string;
  model?: string;
  // System prompt; use {tenantName} and {botName} placeholders
  systemPrompt?: string;
  maxTokens?: number;
  tenantName: string;
  botName: string;
}

const FALLBACK_REPLY =
  'Sorry, our assistant is temporarily unavailable. A human agent will follow up shortly.';

const DEFAULT_SYSTEM =
  'You are a helpful customer service assistant for {tenantName}. You respond via the {botName} bot. Be concise and friendly.';

const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
  claude: 'claude-haiku-4-5-20251001',
  custom: 'gpt-4o-mini',
};

const DEFAULT_BASE_URLS: Partial<Record<AiProvider, string>> = {
  deepseek: 'https://api.deepseek.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  claude: 'https://api.anthropic.com/v1',
};

export class AiReplyService {
  private readonly openai: OpenAI;
  private readonly store: ContextStore;
  private readonly templates: TemplateService;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly maxTokens: number;

  constructor(private readonly config: AiReplyConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? DEFAULT_BASE_URLS[config.provider],
    });
    this.store = new ContextStore();
    this.templates = new TemplateService();
    this.model = config.model ?? DEFAULT_MODELS[config.provider];
    this.systemPrompt = (config.systemPrompt ?? DEFAULT_SYSTEM)
      .replace(/{tenantName}/g, config.tenantName)
      .replace(/{botName}/g, config.botName);
    this.maxTokens = config.maxTokens ?? 256;
  }

  async reply(accountId: string, chatId: string, userText: string): Promise<string> {
    // Fast path: keyword template match (no API call)
    const tplHit = this.templates.match(userText);
    if (tplHit) return tplHit;

    // Append user turn and build full message list
    this.store.append(accountId, chatId, { role: 'user', content: userText });
    const history = this.store.load(accountId, chatId);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: this.systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content } as ChatCompletionMessageParam)),
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
      });
      const reply = completion.choices[0]?.message?.content ?? FALLBACK_REPLY;
      this.store.append(accountId, chatId, { role: 'assistant', content: reply });
      return reply;
    } catch (err) {
      logger.error(`[AiReply:${accountId}] API error:`, err instanceof Error ? err : { err });
      return FALLBACK_REPLY;
    }
  }

  getTemplates(): TemplateService {
    return this.templates;
  }

  clearContext(accountId: string, chatId: string): void {
    this.store.clear(accountId, chatId);
    logger.info(`[AiReply:${accountId}] Context cleared for chat ${chatId}`);
  }
}
