import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AiAgentService } from '../ai-agent/ai-agent.service';
import { AutoReplyDecider } from '../ai-agent/decider.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LeadsService } from '../leads/leads.service';
import { LeadTakeover } from '../leads/lead.entity';
import { TenantsService } from '../tenants/tenants.service';
import { TenantBot } from '../tenants/tenant-bot.entity';
import { BotReplyService } from './bot-reply.service';
import { BotUpdateAdapter, TelegramUpdate } from './bot-update.adapter';

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
  ) {}

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
          const result = await this.aiAgent.reply(
            { chatId: msg.chatId, userMessage: msg.text },
            {
              apiKey: aiConfig.apiKey,
              baseUrl: aiConfig.baseUrl,
              model: aiConfig.model,
              provider: aiConfig.provider === 'custom' ? 'openai' : aiConfig.provider,
            },
          );
          replyText = result.reply;
          this.logger.debug(`BotGateway: AI reply via ${aiConfig.source} key, tenant=${bot.tenantId}`);
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
    }
  }
}
