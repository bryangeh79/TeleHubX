import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AiAgentService } from '../ai-agent/ai-agent.service';
import { AutoReplyDecider } from '../ai-agent/decider.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LeadsService } from '../leads/leads.service';
import { LeadTakeover } from '../leads/lead.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantBot } from '../tenants/tenant-bot.entity';
import { BotReplyService } from './bot-reply.service';
import { BotUpdateAdapter, TelegramUpdate } from './bot-update.adapter';

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
  } = {}): Promise<string> {
    const { kbContext = '', customerType, industryPrompt } = opts;
    const basePersonality = await this.platformConfig.getGlobalPersona();

    const layers: string[] = [basePersonality];

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
            await this.processUpdate(update, bot);
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

    try {
      const settings = await this.tenants.getSettings(bot.tenantId);
      const outcome = await this.decider.decide({
        chatId: msg.chatId,
        userMessage: msg.text,
        mode: settings.replyMode,
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

          // Inject knowledge base context for truly intelligent replies
          const search = await this.knowledge.searchForContext(msg.text, bot.tenantId, 5);
          let contextText = search.contextText;

          // Read product KB metadata (customerType / useCompanyFallback) from first matched product KB
          let customerType: 'b2b' | 'b2c' | 'mixed' | undefined;
          let useCompanyFallback = false;
          const productKb = search.matchedKbs.find(k => k.type === 'product');
          if (productKb?.description) {
            try {
              const desc = JSON.parse(productKb.description);
              if (desc.customerType === 'b2b' || desc.customerType === 'b2c' || desc.customerType === 'mixed') {
                customerType = desc.customerType;
              }
              useCompanyFallback = desc.useCompanyFallback === true;
            } catch { /* description not JSON, ignore */ }
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
          );
          replyText = result.reply;
          this.logger.debug(
            `BotGateway: AI reply via ${aiConfig.source} key, tenant=${bot.tenantId}, ` +
            `hasKb=${!!contextText} customerType=${customerType ?? 'none'} ` +
            `companyFallback=${companyFallbackUsed} industry=${!!industryPrompt}`,
          );
          break;
        }

        case 'handoff':
          await this.leads.takeOver(lead.id);
          this.logger.log(
            `BotGateway: chatId=${msg.chatId} handoff triggered reason="${outcome.reason}"`,
          );
          break;

        case 'rate_limited':
        case 'silent':
          break;
      }
    } catch (err) {
      this.logger.error(`BotGateway: decision/AI error chatId=${msg.chatId}: ${(err as Error).message}`);
      return;
    }

    if (replyText) {
      await this.botReply.sendText(bot.rawToken, msg.chatId, replyText);
      await this.leads.addReply(lead.id, { sender: 'system', text: replyText });
      await this.decider.recordReply(msg.chatId);
      this.getTakeover()?.emitMessage(lead.id, { sender: 'system', text: replyText });
    }
  }
}
