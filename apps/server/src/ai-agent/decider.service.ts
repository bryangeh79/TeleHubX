import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { KnowledgeService } from '../knowledge/knowledge.service';

export type DeciderOutcome =
  | { action: 'reply_faq'; answer: string; matchedFaqId: string }
  | { action: 'reply_ai' }
  | { action: 'handoff'; reason: string }
  | { action: 'rate_limited'; retryAfterMs: number }
  | { action: 'silent'; reason: string };

export interface DeciderInput {
  chatId: string;
  userMessage: string;
  /** When provided, FAQ search is constrained to this KB. */
  kbId?: string;
}

const DEFAULT_HANDOFF_KEYWORDS_ZH = [
  '投诉', '退款', '退订', '退货', '差评', '骗子', '诈骗', '维权',
  '律师', '法律', '法院', '起诉', '报警',
  '经理', '主管', '上级', '老板',
  '账号被封', '被封', '被禁', '被盗',
];

const DEFAULT_HANDOFF_KEYWORDS_EN = [
  'complaint', 'refund', 'unsubscribe', 'lawyer', 'attorney', 'lawsuit',
  'manager', 'supervisor', 'escalate',
  'banned', 'suspended', 'hacked',
  'scam', 'fraud',
];

const RATE_LIMIT_KEY = (chatId: string) => `ai:rate:${chatId}`;
const DAILY_KEY = (chatId: string) => `ai:daily:${chatId}:${new Date().toISOString().slice(0, 10)}`;
const FAQ_SCORE_THRESHOLD = 0.6;

@Injectable()
export class AutoReplyDecider {
  private readonly logger = new Logger(AutoReplyDecider.name);
  private readonly handoffKeywords: string[];
  private readonly minIntervalMs: number;
  private readonly dailyLimit: number;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly knowledge: KnowledgeService,
  ) {
    const customKw = (this.config.get<string>('AI_HANDOFF_KEYWORDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.handoffKeywords = [
      ...customKw,
      ...DEFAULT_HANDOFF_KEYWORDS_ZH,
      ...DEFAULT_HANDOFF_KEYWORDS_EN,
    ];

    this.minIntervalMs = parseInt(this.config.get<string>('AI_MIN_INTERVAL_MS', '3000'), 10);
    this.dailyLimit = parseInt(this.config.get<string>('AI_DAILY_LIMIT_PER_CHAT', '50'), 10);
  }

  /**
   * Run the decision pipeline against an inbound message.
   *
   *   1. Per-chat rate-limit (sub-second flood protection):
   *      if (now - lastReplyAt) < AI_MIN_INTERVAL_MS → rate_limited
   *   2. Per-chat daily cap:
   *      if today's reply count >= AI_DAILY_LIMIT_PER_CHAT → silent
   *   3. Handoff keyword scan:
   *      if any of HANDOFF keywords appear → handoff (no reply, mark needs_human)
   *   4. FAQ match:
   *      run knowledge search; if top score >= 0.6 → reply_faq with that answer
   *   5. Default → reply_ai (caller invokes AiAgentService.reply)
   */
  async decide(input: DeciderInput): Promise<DeciderOutcome> {
    const { chatId, userMessage, kbId } = input;
    const text = userMessage.trim();

    // --- 1. Rate limit (min interval) ---
    const lastReplyAt = await this.redis.get(RATE_LIMIT_KEY(chatId));
    if (lastReplyAt) {
      const elapsed = Date.now() - parseInt(lastReplyAt, 10);
      if (elapsed < this.minIntervalMs) {
        return { action: 'rate_limited', retryAfterMs: this.minIntervalMs - elapsed };
      }
    }

    // --- 2. Daily cap ---
    const dailyKey = DAILY_KEY(chatId);
    const dailyCountRaw = await this.redis.get(dailyKey);
    const dailyCount = dailyCountRaw ? parseInt(dailyCountRaw, 10) : 0;
    if (dailyCount >= this.dailyLimit) {
      return { action: 'silent', reason: `daily AI cap (${this.dailyLimit}) reached for chat ${chatId}` };
    }

    // --- 3. Handoff keywords ---
    const lowered = text.toLowerCase();
    for (const kw of this.handoffKeywords) {
      const k = kw.toLowerCase();
      if (lowered.includes(k)) {
        this.logger.log(`[decider] handoff matched "${kw}" in chat ${chatId}`);
        return { action: 'handoff', reason: `matched keyword "${kw}"` };
      }
    }

    // --- 4. FAQ match ---
    try {
      const matches = await this.knowledge.search(text, kbId, 1);
      if (matches.length && matches[0].score >= FAQ_SCORE_THRESHOLD) {
        const m = matches[0];
        // Fire-and-forget: bump hit counter
        void this.knowledge.recordHit(m.faq.id).catch(() => {});
        return { action: 'reply_faq', answer: m.faq.answer, matchedFaqId: m.faq.id };
      }
    } catch (err) {
      this.logger.warn(`[decider] FAQ search failed: ${err instanceof Error ? err.message : err}`);
    }

    // --- 5. Default to AI ---
    return { action: 'reply_ai' };
  }

  /**
   * Caller invokes this AFTER successfully sending a reply (or having the AI
   * decide to reply). Updates rate-limit timestamp and daily counter.
   */
  async recordReply(chatId: string): Promise<void> {
    const now = Date.now();
    await this.redis.set(RATE_LIMIT_KEY(chatId), String(now), 'EX', 60);
    const dailyKey = DAILY_KEY(chatId);
    await this.redis.incr(dailyKey);
    // expire at midnight UTC the next day (max 48h to be safe)
    await this.redis.expire(dailyKey, 60 * 60 * 30);
  }

  /** Inspection helper for /ai/info or admin debug. */
  config_(): { handoffKeywords: string[]; minIntervalMs: number; dailyLimit: number } {
    return {
      handoffKeywords: this.handoffKeywords,
      minIntervalMs: this.minIntervalMs,
      dailyLimit: this.dailyLimit,
    };
  }
}
