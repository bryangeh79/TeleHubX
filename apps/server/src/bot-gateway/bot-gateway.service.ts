import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';
import { AiAgentService } from '../ai-agent/ai-agent.service';
import { AutoReplyDecider } from '../ai-agent/decider.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LeadsService } from '../leads/leads.service';
import { LeadTakeover } from '../leads/lead.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { TenantsService } from '../tenants/tenants.service';
import { TenantBot } from '../tenants/tenant-bot.entity';
import { BotReplyService } from './bot-reply.service';
import { BotUpdateAdapter, NormalizedMessage, TelegramUpdate } from './bot-update.adapter';
import { langDisplayName, resolveReplyLanguage } from '../common/lang-detect';
import type { DetectableLang } from '../common/lang-detect';

/** Lazy lookup; avoids hard import on TakeoverGateway to dodge circular deps. */
type TakeoverGatewayLike = {
  emitMessage(leadId: string, payload: { sender: 'user' | 'system' | 'human' | 'bot'; text: string; ts?: string }): void;
  emitLeadUpdate(leadId: string): void;
};

const POLL_ERROR_BACKOFF_MS = 5_000;
const POLL_RATE_LIMIT_BACKOFF_MS = 30_000;

@Injectable()
export class BotGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotGatewayService.name);
  private readonly activePollers = new Set<string>();

  constructor(
    private readonly tenants: TenantsService,
    private readonly leads: LeadsService,
    private readonly decider: AutoReplyDecider,
    private readonly aiAgent: AiAgentService,
    private readonly knowledge: KnowledgeService,
    private readonly botReply: BotReplyService,
    private readonly adapter: BotUpdateAdapter,
    private readonly moduleRef: ModuleRef,
    private readonly platformConfig: PlatformConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Build a contextual system prompt for smart reply.
   * Base persona is loaded from platform_settings (editable in Admin panel).
   * If KB context found, inject it so AI answers from real product knowledge.
   * customerType / industryPrompt are optional layered injections.
   */
  private async buildSmartReplyPrompt(opts: {
    kbContext?: string;
    customerType?: 'b2b' | 'b2c' | 'mixed';
    industryPrompt?: string;
    /** Issue #2 Round 2: AI 必须用客户语言回复 */
    replyLanguage?: DetectableLang;
  } = {}): Promise<string> {
    const { kbContext = '', customerType, industryPrompt, replyLanguage } = opts;
    const basePersonality = await this.platformConfig.getGlobalPersona();

    const layers: string[] = [basePersonality];

    // Issue #2 Round 2: 显式语言指令 — AI 必须用客户语言回复
    // 放在第一层 (在 customerType / industry / kbContext 之前), 优先级最高
    if (replyLanguage) {
      layers.push(
        `【LANGUAGE】You MUST reply in ${langDisplayName(replyLanguage)}. ` +
        `Even if the knowledge base content is in another language, you must translate naturally to ${langDisplayName(replyLanguage)} when answering. ` +
        `Keep proper nouns (product names, brand names, prices, contact details, URLs) exactly as written in the source.`,
      );
    }

    if (customerType === 'b2b') {
      layers.push(
        '【客户画像】客户为企业决策者：用「贵公司」「您」称呼，语气专业克制，避免过多 emoji，多强调 ROI / 效率 / 落地方案。',
      );
    } else if (customerType === 'b2c') {
      layers.push(
        '【客户画像】客户为个人消费者：用「你」称呼，语气亲切轻松，可以适度使用 emoji，多强调易用 / 体验 / 优惠。',
      );
    }

    if (industryPrompt && industryPrompt.trim()) {
      layers.push(`【行业话术】${industryPrompt.trim()}`);
    }

    if (kbContext) {
      layers.push(
        '==================================================\n当前知识库参考资料\n==================================================',
        kbContext,
        `回复规则（优先于以上）：
1. 优先用上方知识库内容回答，用自己的话自然表达，不要照抄原文
2. 如果知识库内容和问题相关性低，可以用通用常识回答，但不要捏造产品细节
3. 保留原文中的任何联系方式（电话、链接、账号）不改变
4. 不要在回复里透露"我有一份知识库"或"根据文档"等内部表达`,
      );
    } else {
      layers.push('如果客户问的问题超出你的了解范围，诚实告知并建议转人工。');
    }

    return layers.join('\n\n');
  }

  /**
   * 用户首次打招呼/简短试探类消息. 这种场景 AI 通常会枚举产品介绍, 应该附按钮让客户点选.
   * "hi" / "hello" / "你好" / "在吗" / "/start" 等
   */
  private isGreetingIntent(text: string): boolean {
    const t = text.trim().toLowerCase();
    if (!t || t.length > 20) return false;
    return /^(hi|hello|hey|yo|你好|您好|哈喽|嗨|在吗|在不在|有人吗|\/start)[\s,，.。!！?？]*$/i.test(t);
  }

  /**
   * 扫描 AI 回复文本, 看是否提到了 roster 里的任何产品名.
   * 命中 → 附按钮让客户能点击进入该产品话术.
   * 返回类型用泛型保留 overview 等字段.
   */
  private detectMentionedProducts<T extends { id: string; name: string }>(
    replyText: string,
    roster: T[],
  ): T[] {
    if (!replyText || !roster.length) return [];
    const lower = replyText.toLowerCase();
    return roster.filter((p) => {
      const n = p.name.trim().toLowerCase();
      return n.length >= 2 && lower.includes(n);
    });
  }

  /**
   * 判断客户消息是否在问"产品菜单"类元问题（用于决定是否附 inline keyboard）。
   * 中文 + 英文常见说法。排除单产品细节问题（价格/功能/怎么用 → 走普通 reply）。
   */
  private isProductMenuIntent(text: string): boolean {
    const t = text.toLowerCase().trim();
    if (!t || t.length > 40) return false;
    if (/价格|多少钱|功能|怎么用|教程|文档|case|价位/i.test(t)) return false;
    return /有(什么|哪些|啥|没有)?(产品|服务|套餐|方案)|哪些(产品|服务)|产品列表|你们卖|介绍.{0,3}产品|product\s*list|^what\s+(do\s+you\s+have|products?|services?)|^products?\??$|^services?\??$/i.test(t);
  }

  /**
   * 触发 handoff 时把客户上下文 + tg deep link 推送给所有启用的 operator Telegram。
   * Bot 必须先收到 operator 主动 /start 才有权限推送 — 失败 swallow + log，不阻断主流程。
   */
  private async notifyHumanAgents(
    bot: TenantBot & { rawToken: string },
    lead: { id: string; tgUserId: string; tgUsername?: string | null; product?: string | null; intent?: string; replies?: Array<{ sentBy: string; text: string }> | null },
    reason: string,
  ): Promise<void> {
    const settings = await this.tenants.getSettings(bot.tenantId);
    const operators = (settings.humanAgents ?? []).filter(a => a?.enabled && a?.chatId);
    if (!operators.length) return;

    const recent = (lead.replies ?? []).slice(-5)
      .map(r => `${r.sentBy === 'user' ? '👤' : '🤖'} ${r.text.slice(0, 100)}`)
      .join('\n');
    const dashUrl = process.env.DASHBOARD_URL ?? 'http://localhost:9601';
    const notice = [
      `🚨 新人工接管请求`,
      ``,
      `客户：@${lead.tgUsername ?? '(无 username)'}`,
      `Telegram ID：${lead.tgUserId}`,
      `直接私聊：tg://user?id=${lead.tgUserId}`,
      lead.product ? `产品意向：${lead.product}` : '',
      lead.intent ? `意向等级：${lead.intent}` : '',
      `触发原因：${reason}`,
      ``,
      recent ? `最近 5 条对话：\n${recent}` : '',
      ``,
      `📋 dashboard: ${dashUrl}/leads/${lead.id}`,
    ].filter(Boolean).join('\n');

    await Promise.allSettled(
      operators.map(op =>
        this.botReply.sendText(bot.rawToken, op.chatId, notice).catch(err =>
          this.logger.warn(`通知 operator failed chatId=${op.chatId} name=${op.name}: ${(err as Error).message}`),
        ),
      ),
    );
    this.logger.log(`通知 ${operators.length} 位 operator handoff lead=${lead.id}`);
  }

  /** 构造产品选择 inline keyboard。每行一个按钮（产品名长，竖排好看）。 */
  /**
   * 构造产品选择 inline keyboard.
   * 标签格式 "📦 ProductName · 简短关键词" — 必须能完整显示不被截断.
   *
   * Telegram inline button 不支持文字对齐, 只能按钮内文字默认 left-align.
   * 但 Telegram 会按整行所有按钮的最长那个**统一宽度** (单按钮一行时整行就那个宽度).
   * 所以让所有按钮 label 长度接近 (用空格补齐到最长那个), 视觉上就接近"对齐".
   */
  private buildProductKeyboard(roster: Array<{ id: string; name: string; overview?: string }>) {
    // 先 compute 全部 label
    const labels = roster.map(p => {
      const namePart = `📦 ${p.name}`;
      const tag = this.extractProductTag(p.name, p.overview);
      return tag ? `${namePart} · ${tag}` : namePart;
    });
    // 对齐: pad 到最长那个的可视宽度 (中文 2, 其他 1)
    const visualWidth = (s: string): number => {
      let w = 0;
      for (const ch of s) {
        // CJK 范围算 2 宽, 其他 1 (含 emoji 简化按 2)
        const code = ch.codePointAt(0) ?? 0;
        if (code > 0x2e80) w += 2; else w += 1;
      }
      return w;
    };
    const maxW = Math.max(...labels.map(visualWidth));
    return {
      inline_keyboard: labels.map((label, i) => {
        const pad = maxW - visualWidth(label);
        // 用半角空格补尾, 视觉对齐 (Telegram 按钮不会 trim 中间空格)
        const padded = label + ' '.repeat(Math.max(0, pad));
        return [{ text: padded, callback_data: `prod:${roster[i].id}` }];
      }),
    };
  }

  /**
   * 从 overview 提取一个 ≤6 中文字 / ≤12 英文字的关键词标签.
   * 算法:
   *   1. 去掉开头与产品名重复的部分 ("FAhubX 自动养号系统" → "自动养号系统")
   *   2. 去掉 "是一套" / "是" / "为" 等连接词
   *   3. 取首个名词短语 (停在 第一个 "是"/"，"/"。"/"," 等)
   *   4. 限制长度: 中文 6 字 / 英文 12 字, 超长返回空串 (不显示)
   */
  private extractProductTag(productName: string, overview?: string): string {
    if (!overview) return '';
    let s = overview.trim();
    // 去 BOM / 多余空格
    s = s.replace(/^﻿/, '').replace(/\s+/g, ' ');
    // 去开头的产品名
    const lowerName = productName.toLowerCase();
    if (s.toLowerCase().startsWith(lowerName)) {
      s = s.slice(productName.length).trim();
    }
    // 去开头的连接词
    s = s.replace(/^[是为：:、 ]+(一套|一个|一种|一款|套)?[是为：: ]*/, '').trim();
    // 取首个短句 (碰到标点就停)
    const firstChunk = s.split(/[，。,.;；！!？?\n（(]/)[0]?.trim() ?? '';
    if (!firstChunk) return '';
    // 提取过短 (产品名重复抽掉了平台/关键词上下文) → 不显示 tag
    if (firstChunk.length < 3) return '';
    // 上限 16 字符 — 实测 Telegram mobile 一行可完整显示 ~24 字符,
    // 减去 "📦 ProductName · " 头部后约 16 字符可不出 "..."
    // 用户期望: "📦 FAhubX · Facebook 自动养号系统" (12 字, 完整显示)
    const MAX_CHARS = 16;
    return firstChunk.length > MAX_CHARS ? firstChunk.slice(0, MAX_CHARS) : firstChunk;
  }

  /** TakeoverGateway 解耦查找 — avoids hard import to break circular dep with TakeoverModule. */
  private getTakeover(): TakeoverGatewayLike | null {
    try {
      return (this.moduleRef.get('TakeoverGateway' as any, { strict: false }) as TakeoverGatewayLike) ?? null;
    } catch {
      return null;
    }
  }

  async onModuleInit(): Promise<void> {
    const bots = await this.tenants.findActiveBotsWithTokens();
    this.logger.log(`BotGateway: starting polling for ${bots.length} active bot(s)`);
    for (const bot of bots) {
      this.startPolling(bot.id);
    }
  }

  onModuleDestroy(): void {
    this.activePollers.clear();
  }

  startPolling(botId: string): void {
    if (this.activePollers.has(botId)) return;
    this.activePollers.add(botId);
    setImmediate(() => this.pollLoop(botId));
    this.logger.log(`BotGateway: started polling botId=${botId}`);
  }

  stopPolling(botId: string): void {
    this.activePollers.delete(botId);
    this.logger.log(`BotGateway: stopped polling botId=${botId}`);
  }

  private async pollLoop(botId: string): Promise<void> {
    while (this.activePollers.has(botId)) {
      let bot: TenantBot & { rawToken: string };
      try {
        bot = await this.tenants.findBotWithToken(botId);
      } catch {
        this.logger.warn(`BotGateway: botId=${botId} no longer exists, stopping poll`);
        this.activePollers.delete(botId);
        return;
      }

      if (!bot.isActive) {
        this.logger.log(`BotGateway: botId=${botId} isActive=false, stopping poll`);
        this.activePollers.delete(botId);
        return;
      }

      try {
        const updates = await this.botReply.getUpdates(bot.rawToken, bot.pollingOffset);
        if (updates.length > 0) {
          for (const update of updates) {
            // Codex round-11 #4: 幂等检查 — 防 sendText 成功但 offset 更新前崩溃
            // 重启后 Telegram 重投同 update → 此处跳过, 不重发自动回复
            const dedupeKey = `bot:update:${botId}:${update.update_id}`;
            const seen = await this.redis.set(dedupeKey, '1', 'EX', 7 * 86400, 'NX');
            if (seen !== 'OK') {
              this.logger.warn(`BotGateway: skip duplicate update ${update.update_id} for bot=${botId}`);
              continue;
            }
            try {
              await this.processUpdate(update, bot);
            } catch (procErr) {
              // 处理失败 → 删 dedupe key 让下次能重试 (避免一次失败永远跳过)
              await this.redis.del(dedupeKey).catch(() => {});
              throw procErr;
            }
          }
          const newOffset = Math.max(...updates.map((u) => u.update_id)) + 1;
          await this.tenants.updateBotOffset(botId, newOffset);
        }
        if (bot.lastError) await this.tenants.updateBotError(botId, null);
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        const status = e.statusCode ?? 0;

        if (status === 401) {
          this.logger.error(`BotGateway: botId=${botId} token invalid (401), disabling`);
          await this.tenants.setBotActive(botId, false);
          await this.tenants.updateBotError(botId, 'Token invalid (401)');
          this.activePollers.delete(botId);
          return;
        }

        const backoff = status === 429 ? POLL_RATE_LIMIT_BACKOFF_MS : POLL_ERROR_BACKOFF_MS;
        this.logger.warn(`BotGateway: botId=${botId} poll error: ${e.message}, backoff ${backoff}ms`);
        await this.tenants.updateBotError(botId, e.message);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  private async processUpdate(
    update: TelegramUpdate,
    bot: TenantBot & { rawToken: string },
  ): Promise<void> {
    const msg = this.adapter.normalize(update);
    if (!msg) return;

    if (msg.kind === 'callback') {
      await this.handleProductPickCallback(msg, bot);
      return;
    }

    this.logger.debug(
      `BotGateway: update botId=${bot.id} tenantId=${bot.tenantId} chatId=${msg.chatId} text="${msg.text.slice(0, 40)}"`,
    );

    const lead = await this.leads.findOrCreateByTgChatId(msg.tgUserId, bot.tenantId, msg.tgUsername);

    await this.leads.addReply(lead.id, { sender: 'user', text: msg.text });

    // 实时推送给订阅了此 lead 的 operator (任何人在 /leads 页打开该对话)
    this.getTakeover()?.emitMessage(lead.id, { sender: 'user', text: msg.text });
    this.getTakeover()?.emitLeadUpdate(lead.id);

    if (lead.takeoverState === LeadTakeover.HUMAN) {
      this.logger.debug(`BotGateway: chatId=${msg.chatId} takeoverState=HUMAN, skipping AI`);
      return;
    }

    if (lead.takeoverState === LeadTakeover.CLOSED || lead.takeoverState === LeadTakeover.DNR) {
      return;
    }

    let replyText: string | null = null;
    let replyMarkup: ReturnType<typeof this.buildProductKeyboard> | undefined;

    try {
      const settings = await this.tenants.getSettings(bot.tenantId);

      // Issue #2 Round 2: resolve 客户回复语言
      //   1. settings.customerReplyLanguage != 'auto' → 直接用
      //   2. auto → detectCustomerLanguage(msg.text)
      //   3. 检测失败 → settings.contentDefaultLanguage
      //   4. fallback 'zh'
      const contentDefaultLanguage = (settings as any).contentDefaultLanguage ?? 'zh';
      const customerReplyLanguage = (settings as any).customerReplyLanguage ?? 'auto';
      const resolvedLanguage = resolveReplyLanguage({
        messageText: msg.text,
        customerReplyLanguage,
        contentDefaultLanguage,
      });

      // Codex round-10 #1 #3 #4: 必传 tenantId/botId, 透传 daily limit + quiet hours
      // Issue #2 Round 2: 透传 customerLanguage + contentDefaultLanguage
      const outcome = await this.decider.decide({
        chatId: msg.chatId,
        userMessage: msg.text,
        mode: settings.replyMode,
        tenantId: bot.tenantId,
        botId: bot.id,
        dailyReplyLimit: (settings as any).dailyReplyLimit ?? null,
        quietHoursEnabled: (settings as any).quietHoursEnabled ?? false,
        quietHoursStart: (settings as any).quietHoursStart ?? null,
        quietHoursEnd: (settings as any).quietHoursEnd ?? null,
        customerLanguage: resolvedLanguage,
        contentDefaultLanguage,
      });

      switch (outcome.action) {
        case 'reply_faq':
          replyText = outcome.answer;
          await this.knowledge.recordHit(outcome.matchedFaqId);
          break;

        case 'reply_ai': {
          const aiConfig = await this.tenants.getEffectiveAiConfig(bot.tenantId);
          if (!aiConfig) {
            this.logger.warn(`BotGateway: no AI config for tenant=${bot.tenantId}, skipping AI reply`);
            break;
          }

          // Always inject product roster (so AI can answer meta questions like "你有什么产品")
          const roster = await this.knowledge.getProductRoster(bot.tenantId);

          // 客户问产品菜单 / 简短打招呼 → 给 Bot 回复挂上产品按钮 (用户反馈: hi 类消息也应有按钮)
          if (
            roster.length >= 1 &&
            (this.isProductMenuIntent(msg.text) || this.isGreetingIntent(msg.text))
          ) {
            replyMarkup = this.buildProductKeyboard(roster);
          }
          const rosterBlock = roster.length
            ? '【在售产品列表（按需介绍，不要全部塞给客户）】\n' +
              roster.map((p, i) => {
                const parts = [`${i + 1}. ${p.name}`];
                if (p.price) parts.push(`价格：${p.price}`);
                if (p.overview) parts.push(`简介：${p.overview}`);
                return parts.join(' · ');
              }).join('\n')
            : '';

          // Direct product-name detection — Jaccard search misses queries that are JUST a product name
          // (e.g. "fahubx" or "M33") because FAQ questions are customer-style ("你们..."), not product names.
          const lowerMsg = msg.text.toLowerCase();
          const directlyMentionedProducts = roster.filter(p => {
            const n = (p.name ?? '').toLowerCase().trim();
            return n.length >= 2 && lowerMsg.includes(n);
          });

          // Inject knowledge base context for truly intelligent replies
          // Issue #2 Round 2: 优先用客户语言的 published FAQ, 不够时 fallback contentDefaultLanguage
          const search = await this.knowledge.searchForContext(msg.text, bot.tenantId, 5, {
            customerLanguage: resolvedLanguage,
            contentDefaultLanguage,
          });
          let contextText = rosterBlock
            ? (search.contextText ? `${rosterBlock}\n\n${search.contextText}` : rosterBlock)
            : search.contextText;

          // Read product KB metadata (customerType / useCompanyFallback) — prefer FAQ-matched product KB,
          // fall back to direct-name-mentioned product, so "fahubx" alone still picks up that KB's settings.
          let customerType: 'b2b' | 'b2c' | 'mixed' | undefined;
          let useCompanyFallback = false;
          let activeProductId: string | undefined;
          const matchedProductKb = search.matchedKbs.find(k => k.type === 'product');
          if (matchedProductKb?.description) {
            try {
              const desc = JSON.parse(matchedProductKb.description);
              if (desc.customerType === 'b2b' || desc.customerType === 'b2c' || desc.customerType === 'mixed') {
                customerType = desc.customerType;
              }
              useCompanyFallback = desc.useCompanyFallback === true;
              activeProductId = matchedProductKb.id;
            } catch { /* description not JSON, ignore */ }
          } else if (directlyMentionedProducts.length === 1) {
            // Single direct-mention: use its settings
            const p = directlyMentionedProducts[0];
            customerType = p.customerType;
            activeProductId = p.id;
          }

          // Trigger company fallback when product hits are weak
          let companyFallbackUsed = false;
          if (useCompanyFallback && search.productHitCount < 3) {
            const company = await this.knowledge.searchCompanyContext(msg.text, bot.tenantId, 5);
            if (company.hasResults) {
              contextText = contextText
                ? `${contextText}\n\n${company.contextText}`
                : company.contextText;
              companyFallbackUsed = true;
            }
          }

          // Read industry from company KB → drive industry-specific prompt injection
          let industryPrompt: string | undefined;
          const companyKb = await this.knowledge.getCompanyKb(bot.tenantId);
          if (companyKb?.description) {
            try {
              const desc = JSON.parse(companyKb.description);
              if (desc.industry) {
                industryPrompt = await this.platformConfig.getIndustryPrompt(String(desc.industry));
              }
            } catch { /* ignore */ }
          }

          const systemPrompt = await this.buildSmartReplyPrompt({
            kbContext: contextText,
            customerType,
            industryPrompt,
            replyLanguage: resolvedLanguage,
          });

          const result = await this.aiAgent.reply(
            {
              chatId: msg.chatId,
              userMessage: msg.text,
              systemPrompt,
            },
            {
              apiKey: aiConfig.apiKey,
              baseUrl: aiConfig.baseUrl,
              model: aiConfig.model,
              provider: aiConfig.provider === 'custom' ? 'openai' : aiConfig.provider,
            },
            // Codex round-10 #2: 隔离 conv key 防跨租户/跨 bot 串线
            { tenantId: bot.tenantId, botId: bot.id },
          );
          replyText = result.reply;

          // 用户反馈: AI 回复中提到产品名时也应附按钮 (greeting 场景 AI 自然枚举产品)
          // 已有 replyMarkup 不覆盖 (greeting/menuIntent 已挂); 否则扫描 reply 看提到哪些产品
          if (!replyMarkup && roster.length >= 1) {
            const mentionedInReply = this.detectMentionedProducts(replyText, roster);
            if (mentionedInReply.length >= 1) {
              // 只显示被提到的产品按钮 (而非全 roster) — 更聚焦; 多于 4 个降级显示全 roster
              replyMarkup = mentionedInReply.length <= 4
                ? this.buildProductKeyboard(mentionedInReply)
                : this.buildProductKeyboard(roster);
            }
          }

          this.logger.debug(
            `BotGateway: AI reply via ${aiConfig.source} key, tenant=${bot.tenantId}, ` +
            `hasKb=${!!contextText} customerType=${customerType ?? 'none'} ` +
            `companyFallback=${companyFallbackUsed} industry=${!!industryPrompt} ` +
            `directMention=${directlyMentionedProducts.map(p => p.name).join('|') || 'none'} ` +
            `activeProduct=${activeProductId ? activeProductId.slice(0, 8) : 'none'} ` +
            `menuKeyboard=${replyMarkup ? `${replyMarkup.inline_keyboard.length}btn` : 'no'}`,
          );
          break;
        }

        case 'handoff': {
          await this.leads.takeOver(lead.id);
          this.logger.log(
            `BotGateway: chatId=${msg.chatId} handoff triggered reason="${outcome.reason}"`,
          );
          // (A) 通知客户已转接（避免干等）
          replyText = await this.platformConfig.getHandoffNotice();
          // (C) 通知所有启用的 operator Telegram
          await this.notifyHumanAgents(bot, lead, outcome.reason).catch(err =>
            this.logger.warn(`通知 operator 失败: ${(err as Error).message}`),
          );
          // takeover gateway 推送一次状态更新（dashboard 立刻看到 HUMAN）
          this.getTakeover()?.emitLeadUpdate(lead.id);
          break;
        }

        case 'rate_limited':
        case 'silent':
          break;
      }
    } catch (err) {
      this.logger.error(`BotGateway: decision/AI error chatId=${msg.chatId}: ${(err as Error).message}`);
      return;
    }

    if (replyText) {
      // Codex round-11 #5: 检查 sendText 结果, 失败时不写"已回复"也不计入 daily limit
      const sendResult = await this.botReply.sendText(bot.rawToken, msg.chatId, replyText, replyMarkup);
      if (sendResult?.ok) {
        await this.leads.addReply(lead.id, { sender: 'system', text: replyText });
        await this.decider.recordReply(msg.chatId, bot.tenantId);
        this.getTakeover()?.emitMessage(lead.id, { sender: 'system', text: replyText });
      } else {
        this.logger.error(
          `BotGateway: sendText FAILED chatId=${msg.chatId} reason="${sendResult?.description ?? 'unknown'}", ` +
          `not recording reply (lead 不会显示已回复, daily limit 不计数)`,
        );
      }
    }
  }

  /**
   * 客户点了 inline keyboard 上的产品按钮 → 进入该产品话术。
   * 流程：解析 callback_data → 找产品 KB → AI 用合成 prompt 介绍该产品 → 回复 + answer callback。
   */
  private async handleProductPickCallback(
    msg: NormalizedMessage,
    bot: TenantBot & { rawToken: string },
  ): Promise<void> {
    const data = msg.callbackData ?? '';
    if (!data.startsWith('prod:')) {
      // 未知 callback 类型，仅 ack
      if (msg.callbackQueryId) await this.botReply.answerCallbackQuery(bot.rawToken, msg.callbackQueryId);
      return;
    }
    const kbId = data.slice(5);

    let kb;
    try { kb = await this.knowledge.getKb(kbId); } catch {
      if (msg.callbackQueryId) await this.botReply.answerCallbackQuery(bot.rawToken, msg.callbackQueryId, '产品已下架');
      return;
    }
    // Codex round-10 #6: 校验 KB 属于此 bot 的租户, 防 cross-tenant 信息泄漏
    if (kb.tenantId && kb.tenantId !== bot.tenantId) {
      this.logger.warn(
        `BotGateway: callback prod blocked cross-tenant kbId=${kbId.slice(0, 8)} botTenant=${bot.tenantId}`,
      );
      if (msg.callbackQueryId) await this.botReply.answerCallbackQuery(bot.rawToken, msg.callbackQueryId, '产品不可用');
      return;
    }

    let productName = kb.name?.replace(/\s*-\s*产品资料$/, '').trim() ?? kb.name;
    let overview = '';
    let price = '';
    let customerType: 'b2b' | 'b2c' | 'mixed' | undefined;
    if (kb.description) {
      try {
        const d = JSON.parse(kb.description);
        if (d.productName) productName = String(d.productName).trim();
        overview = String(d.overview ?? '').trim();
        price = String(d.price ?? '').trim();
        if (d.customerType === 'b2b' || d.customerType === 'b2c' || d.customerType === 'mixed') customerType = d.customerType;
      } catch { /* ignore */ }
    }

    this.logger.debug(
      `BotGateway: callback prod chatId=${msg.chatId} product="${productName}" customerType=${customerType ?? 'none'}`,
    );

    const lead = await this.leads.findOrCreateByTgChatId(msg.tgUserId, bot.tenantId, msg.tgUsername);
    const userTurnText = `[选择了 ${productName}]`;
    await this.leads.addReply(lead.id, { sender: 'user', text: userTurnText });
    this.getTakeover()?.emitMessage(lead.id, { sender: 'user', text: userTurnText });
    this.getTakeover()?.emitLeadUpdate(lead.id);

    if (lead.takeoverState === LeadTakeover.HUMAN || lead.takeoverState === LeadTakeover.CLOSED || lead.takeoverState === LeadTakeover.DNR) {
      if (msg.callbackQueryId) await this.botReply.answerCallbackQuery(bot.rawToken, msg.callbackQueryId);
      return;
    }

    const aiConfig = await this.tenants.getEffectiveAiConfig(bot.tenantId);
    if (!aiConfig) {
      if (msg.callbackQueryId) await this.botReply.answerCallbackQuery(bot.rawToken, msg.callbackQueryId, '稍后再试');
      return;
    }

    // Issue #2 Round 2: 按客户最近一条消息识别语言 (无消息 → contentDefaultLanguage)
    const callbackSettings = await this.tenants.getSettings(bot.tenantId);
    const callbackContentDefaultLang = (callbackSettings as any).contentDefaultLanguage ?? 'zh';
    const callbackCustReplyLang = (callbackSettings as any).customerReplyLanguage ?? 'auto';
    // 回调没有 user message → 用历史最后一条 user 消息检测; 没有则 fallback contentDefault
    const lastUserMsg = (lead.replies ?? [])
      .filter((r: any) => r.sender === 'user' && r.text && !r.text.startsWith('[选择了'))
      .slice(-1)[0]?.text ?? '';
    const callbackResolvedLang = resolveReplyLanguage({
      messageText: lastUserMsg,
      customerReplyLanguage: callbackCustReplyLang,
      contentDefaultLanguage: callbackContentDefaultLang,
    });

    // Industry prompt
    let industryPrompt: string | undefined;
    const companyKb = await this.knowledge.getCompanyKb(bot.tenantId);
    if (companyKb?.description) {
      try {
        const d = JSON.parse(companyKb.description);
        if (d.industry) industryPrompt = await this.platformConfig.getIndustryPrompt(String(d.industry));
      } catch { /* ignore */ }
    }

    // 合成 user message：要求 AI 简短介绍该产品并询问需求
    const synthesizedUserMsg = `客户从产品菜单点选了产品『${productName}』。请简短介绍这个产品（2-3 句，重点说能解决什么问题），然后问对方主要想用在什么场景，方便给更准确的建议。`;

    // 合成 KB context：直接把该产品的 overview + price 注入，无需 search
    const kbBlock = [
      `【客户已选择产品】${productName}`,
      price ? `价格：${price}` : '',
      overview ? `简介：${overview}` : '',
      kb.goalPrompt ? `\n销售目标：${kb.goalPrompt}` : '',
    ].filter(Boolean).join('\n');

    const systemPrompt = await this.buildSmartReplyPrompt({
      kbContext: kbBlock,
      customerType,
      industryPrompt,
      replyLanguage: callbackResolvedLang,
    });

    let replyText = '';
    try {
      const result = await this.aiAgent.reply(
        { chatId: msg.chatId, userMessage: synthesizedUserMsg, systemPrompt },
        {
          apiKey: aiConfig.apiKey,
          baseUrl: aiConfig.baseUrl,
          model: aiConfig.model,
          provider: aiConfig.provider === 'custom' ? 'openai' : aiConfig.provider,
        },
        // Codex round-10 #2: 隔离 conv key
        { tenantId: bot.tenantId, botId: bot.id },
      );
      replyText = result.reply;
    } catch (err) {
      this.logger.error(`BotGateway: callback AI error chatId=${msg.chatId}: ${(err as Error).message}`);
    }

    if (replyText) {
      // Codex round-11 #5: 同上 sendText 失败保护
      const sendResult = await this.botReply.sendText(bot.rawToken, msg.chatId, replyText);
      if (sendResult?.ok) {
        await this.leads.addReply(lead.id, { sender: 'system', text: replyText });
        await this.decider.recordReply(msg.chatId, bot.tenantId);
        this.getTakeover()?.emitMessage(lead.id, { sender: 'system', text: replyText });
      } else {
        this.logger.error(
          `BotGateway: callback sendText FAILED chatId=${msg.chatId} reason="${sendResult?.description ?? 'unknown'}"`,
        );
      }
    }

    if (msg.callbackQueryId) {
      await this.botReply.answerCallbackQuery(bot.rawToken, msg.callbackQueryId);
    }
  }
}
