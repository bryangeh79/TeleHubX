import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ReplyMode } from '../tenants/tenant-settings.entity';

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
  /** Tenant-level reply mode. Defaults to SMART (FAQ + AI fallback). */
  mode?: ReplyMode;
  /** Codex round-10 #1: 必传, FAQ 搜索 + Redis key 都按租户隔离 */
  tenantId: string;
  /** Codex round-10 #2: 多 bot 同租户场景下用作 conv key 隔离 (推荐传) */
  botId?: string;
  /** Codex round-10 #4: 租户 settings — 不传时用 env fallback */
  dailyReplyLimit?: number | null;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string | null;   // "HH:mm"
  quietHoursEnd?: string | null;
  /**
   * Issue #2 Round 2: 已 resolve 的客户回复语言 (zh / en / ms / vi).
   * 由 BotGateway 根据 settings.customerReplyLanguage + lang-detect 解析后传入.
   * 不传 = 不按语言过滤 (老行为, 跨语言 FAQ 都参与匹配).
   */
  customerLanguage?: string;
  /** Issue #2 Round 2: 租户 contentDefaultLanguage, 用于 FAQ fallback. */
  contentDefaultLanguage?: string;
}

const DEFAULT_HANDOFF_KEYWORDS_ZH = [
  '投诉', '退款', '退订', '退货', '差评', '骗子', '诈骗', '维权',
  '律师', '法律', '法院', '起诉', '报警',
  '经理', '主管', '上级', '老板',
  '账号被封', '被封', '被禁', '被盗',
  // 客户主动要求真人 → 硬转人工
  '真人客服', '真人', '人工客服', '人工', '转人工', '转接人工', '找客服', '找人工',
  '客服小哥', '客服小姐', '联系客服',
];

const DEFAULT_HANDOFF_KEYWORDS_EN = [
  'complaint', 'refund', 'unsubscribe', 'lawyer', 'attorney', 'lawsuit',
  'manager', 'supervisor', 'escalate',
  'banned', 'suspended', 'hacked',
  'scam', 'fraud',
  // Customer asks for human → hard handoff
  'human agent', 'real person', 'speak to human', 'talk to human', 'live agent', 'human support',
];

// Codex round-10 #3: rate/daily key 加 tenant 前缀, 不同租户互不影响
// 同 chatId 在 A 租户达上限不会让 B 租户也限流
const RATE_LIMIT_KEY = (tenantId: string, chatId: string) => `ai:rate:${tenantId}:${chatId}`;
const DAILY_KEY = (tenantId: string, chatId: string) => `ai:daily:${tenantId}:${chatId}:${new Date().toISOString().slice(0, 10)}`;

/** Codex round-10 #4: 检查当前时间是否在静默时段内, 支持跨午夜 (e.g. 22:00-08:00) */
export function isInQuietHours(now: Date, startHHmm: string, endHHmm: string): boolean {
  const [sH, sM] = startHHmm.split(':').map(Number);
  const [eH, eM] = endHHmm.split(':').map(Number);
  if (Number.isNaN(sH) || Number.isNaN(eH)) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = sH * 60 + sM;
  const end = eH * 60 + eM;
  if (start === end) return false;  // 0 区间
  if (start < end) {
    // 同日: e.g. 09:00-18:00 → cur ∈ [start, end)
    return cur >= start && cur < end;
  }
  // 跨午夜: e.g. 22:00-08:00 → cur >= start OR cur < end
  return cur >= start || cur < end;
}
/** Jaccard similarity threshold to short-circuit reply with FAQ answer (matches WAhubX 0.55). */
const FAQ_SCORE_THRESHOLD = 0.55;

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
    const { chatId, userMessage, kbId, mode = ReplyMode.SMART, tenantId } = input;
    const text = userMessage.trim();

    if (!tenantId) {
      // 防御编程: 强制传 tenantId, 漏传立即抛而不是降级跨租户搜
      throw new Error('DeciderInput.tenantId required (Codex round-10 #1)');
    }

    // --- 0. Mode gate ---
    if (mode === ReplyMode.OFF) {
      return { action: 'silent', reason: 'reply_mode=off (100% human)' };
    }

    // --- 0.5 静默时段 (Codex round-10 #4) — quiet hours 内转 handoff, 不静默丢客户 ---
    if (input.quietHoursEnabled && input.quietHoursStart && input.quietHoursEnd) {
      if (isInQuietHours(new Date(), input.quietHoursStart, input.quietHoursEnd)) {
        return {
          action: 'handoff',
          reason: `quiet hours ${input.quietHoursStart}-${input.quietHoursEnd}, defer to human`,
        };
      }
    }

    // --- 1. Rate limit (min interval) — 按 tenant scoped key ---
    const lastReplyAt = await this.redis.get(RATE_LIMIT_KEY(tenantId, chatId));
    if (lastReplyAt) {
      const elapsed = Date.now() - parseInt(lastReplyAt, 10);
      if (elapsed < this.minIntervalMs) {
        return { action: 'rate_limited', retryAfterMs: this.minIntervalMs - elapsed };
      }
    }

    // --- 2. Daily cap — tenant 自定义优先, fallback env ---
    const effectiveDailyLimit = (input.dailyReplyLimit && input.dailyReplyLimit > 0)
      ? input.dailyReplyLimit
      : this.dailyLimit;
    const dailyKey = DAILY_KEY(tenantId, chatId);
    const dailyCountRaw = await this.redis.get(dailyKey);
    const dailyCount = dailyCountRaw ? parseInt(dailyCountRaw, 10) : 0;
    if (dailyCount >= effectiveDailyLimit) {
      return { action: 'silent', reason: `daily AI cap (${effectiveDailyLimit}) reached for chat ${chatId}` };
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

    // --- 4. FAQ match (tenant + status='published' + language fallback) ---
    // Issue #2 Round 2:
    //   1. 先用 customerLanguage 查 published FAQ
    //   2. 未命中 → fallback contentDefaultLanguage published FAQ
    //   3. 仍未命中 → 走下一步 (handoff for FAQ mode, AI for SMART)
    //   4. status='draft' 永远不参与 — 草稿绝不发给客户
    try {
      const tryMatch = async (lang: string | undefined) => {
        const matches = await this.knowledge.search(text, {
          kbId,
          tenantId,
          status: 'published',
          language: lang,
          topN: 1,
        });
        return matches.length && matches[0].score >= FAQ_SCORE_THRESHOLD ? matches[0] : null;
      };

      // Stage 1: 客户语言
      let hit = input.customerLanguage ? await tryMatch(input.customerLanguage) : null;
      // Stage 2: fallback contentDefaultLanguage (避免重复查同语言)
      if (!hit && input.contentDefaultLanguage && input.contentDefaultLanguage !== input.customerLanguage) {
        hit = await tryMatch(input.contentDefaultLanguage);
      }
      // Stage 3: 都没传 → 兼容老行为, 不限语言但限 published
      if (!hit && !input.customerLanguage && !input.contentDefaultLanguage) {
        hit = await tryMatch(undefined);
      }

      if (hit) {
        void this.knowledge.recordHit(hit.faq.id).catch(() => {});
        return { action: 'reply_faq', answer: hit.faq.answer, matchedFaqId: hit.faq.id };
      }
    } catch (err) {
      this.logger.warn(`[decider] FAQ search failed: ${err instanceof Error ? err.message : err}`);
    }

    // --- 5. Default — Codex round-10 #5: FAQ 模式无命中 → handoff 不再 silent
    //   silent 会让客户消息石沉大海, handoff 让人工接管页能接到, 不丢客户 ---
    if (mode === ReplyMode.FAQ) {
      return { action: 'handoff', reason: 'reply_mode=faq + no FAQ match → defer to human' };
    }
    return { action: 'reply_ai' };
  }

  /**
   * Caller invokes this AFTER successfully sending a reply.
   * Codex round-10 #3: tenantId 必传, 与 decide() key 一致
   */
  async recordReply(chatId: string, tenantId: string): Promise<void> {
    if (!tenantId) throw new Error('recordReply: tenantId required');
    const now = Date.now();
    await this.redis.set(RATE_LIMIT_KEY(tenantId, chatId), String(now), 'EX', 60);
    const dailyKey = DAILY_KEY(tenantId, chatId);
    await this.redis.incr(dailyKey);
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
