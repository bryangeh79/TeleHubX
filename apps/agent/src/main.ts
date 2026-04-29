import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { logger } from './logger';
import { registerSignalHandlers, onShutdown } from './shutdown';
import { ConnectionManager } from './telegram/telegram-client.service';
import { attachMessageHandler } from './telegram/message-handler';
import { KeepOnlineService } from './telegram/keeponline';
import { WarmupController, WarmupPhase } from './warmup/warmup.controller';
import { CampaignExecutor } from './campaign/campaign.executor';
import { AiReplyService } from './ai/ai-reply.service';

// Register signal + uncaughtException handlers first so nothing slips through
registerSignalHandlers();

async function bootstrap(): Promise<void> {
  const apiId = parseInt(process.env.TG_API_ID ?? '0', 10);
  const apiHash = process.env.TG_API_HASH ?? '';
  const phone = process.env.TG_PHONE ?? '';
  const session = process.env.TG_SESSION ?? '';

  if (!apiId || !apiHash || !phone) {
    logger.warn('TeleHubX Agent — set TG_API_ID, TG_API_HASH, TG_PHONE, TG_SESSION in .env to connect');
    return;
  }

  // --- Telegram connection ---
  const manager = new ConnectionManager();
  const keepOnline = new KeepOnlineService();

  const proxy = process.env.TG_PROXY_IP
    ? {
        ip: process.env.TG_PROXY_IP,
        port: parseInt(process.env.TG_PROXY_PORT ?? '1080', 10),
        socksType: 5 as const,
        username: process.env.TG_PROXY_USER,
        password: process.env.TG_PROXY_PASS,
      }
    : undefined;

  const accountId = process.env.ACCOUNT_ID ?? 'account-1';
  const accountRole = (process.env.ACCOUNT_ROLE ?? 'ad') as 'ad' | 'cs' | 'hybrid';

  logger.info(`Connecting account ${accountId} (role: ${accountRole})`);

  const client = await manager.addAccount(accountId, {
    phoneNumber: phone,
    sessionString: session,
    apiId,
    apiHash,
    proxy,
  });

  const me = await client.getMe();
  logger.info(`Logged in as ${(me as { username?: string }).username ?? phone} (state: ${manager.getState(accountId)})`);

  // --- P4: AI Reply (cs role only, opt-in via env) ---
  let aiReplyService: AiReplyService | undefined;
  if (accountRole === 'cs' && process.env.AI_API_KEY) {
    aiReplyService = new AiReplyService({
      provider: (process.env.AI_PROVIDER ?? 'openai') as AiReplyService['config']['provider'],
      apiKey: process.env.AI_API_KEY,
      baseUrl: process.env.AI_BASE_URL,
      model: process.env.AI_MODEL,
      systemPrompt: process.env.AI_SYSTEM_PROMPT,
      tenantName: process.env.TENANT_NAME ?? 'TeleHubX',
      botName: process.env.BOT_USERNAME ?? 'your_bot',
    });
    logger.info(`[AI] Provider: ${process.env.AI_PROVIDER ?? 'openai'}, model: ${process.env.AI_MODEL ?? 'default'}`);
  }

  // --- Message handler ---
  attachMessageHandler(client, {
    role: accountRole,
    accountId,
    botUsername: process.env.BOT_USERNAME ?? 'your_bot',
    adGroupFaqReply: process.env.AD_GROUP_FAQ_REPLY ?? 'For more details please DM our bot!',
    aiReplyService,
  });

  // --- KeepOnline heartbeat ---
  keepOnline.start(client);
  logger.info('KeepOnline active');

  // --- P2: Warmup controller (opt-in via env) ---
  let warmup: WarmupController | undefined;
  const warmupPhaseEnv = process.env.WARMUP_PHASE;
  if (warmupPhaseEnv !== undefined) {
    const phase = parseInt(warmupPhaseEnv, 10) as WarmupPhase;
    const groupPeers = process.env.WARMUP_PEERS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    const contentPool = process.env.WARMUP_CONTENT?.split('|').map((s) => s.trim()).filter(Boolean) ?? [];
    warmup = new WarmupController(client, { accountId, phase, groupPeers, contentPool });
    warmup.start();
  }

  // --- P3: Campaign executor (opt-in via env) ---
  let campaign: CampaignExecutor | undefined;
  const serverUrl = process.env.SERVER_URL;
  if (serverUrl) {
    campaign = new CampaignExecutor(client, accountId, serverUrl);
    campaign.start();
    logger.info(`[Campaign] Executor polling ${serverUrl}`);
  }

  // --- Graceful shutdown hooks ---
  onShutdown(async () => {
    warmup?.stop();
    campaign?.stop();
    keepOnline.stop();
    await manager.removeAccount(accountId);
    logger.info(`Account ${accountId} disconnected`);
  });

  logger.info(`TeleHubX Agent ready — account ${accountId}, role ${accountRole}`);
}

bootstrap().catch((err: unknown) => {
  logger.error('Bootstrap failed:', err instanceof Error ? err : { err });
  process.exit(1);
});
