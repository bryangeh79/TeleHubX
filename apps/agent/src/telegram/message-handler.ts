import { TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';
import { AiReplyService } from '../ai/ai-reply.service';
import { logger } from '../logger';

export type AccountRole = 'ad' | 'cs' | 'hybrid';

export interface MessageHandlerConfig {
  role: AccountRole;
  accountId: string;
  /** 本账号自己的 TG user id (避免回复 self；可选, 安全冗余) */
  selfTgUserId?: string | null;
  // Placeholder bot username for ad-account private divert message
  botUsername: string;
  // Short reply sent by ad account in group when directly mentioned
  adGroupFaqReply: string;
  // If provided, cs role uses AI to reply; otherwise falls back to a static ack
  aiReplyService?: AiReplyService;
  /** 自己人白名单获取器：返回当前所有本租户已绑账号的 tgUserId 集合 */
  getOwnNetwork?: () => Set<string>;
}

/**
 * 全局速率锁: per (accountId, chatId) 60 秒窗口内最多回复 1 次。
 * 即使逻辑层有 bug 也不会刷出 444 条 FAQ-loop 灾难。
 */
const RATE_WINDOW_MS = 60_000;
const recentReplies = new Map<string, number>();
function consumeRateLimit(accountId: string, chatId: string): boolean {
  const key = `${accountId}:${chatId}`;
  const now = Date.now();
  const last = recentReplies.get(key);
  if (last && now - last < RATE_WINDOW_MS) return false;
  recentReplies.set(key, now);
  // 偶尔清理过期 entries (size > 1000 时)
  if (recentReplies.size > 1000) {
    for (const [k, t] of recentReplies) {
      if (now - t >= RATE_WINDOW_MS) recentReplies.delete(k);
    }
  }
  return true;
}

function extractFromUserId(msg: Api.Message): string | null {
  // private chat: peerId is PeerUser, that's the OTHER side's id.
  // group/channel: msg.fromId tells us the sender.
  const fromId = (msg as any).fromId;
  if (fromId instanceof Api.PeerUser) return String(fromId.userId);
  if (msg.peerId instanceof Api.PeerUser) return String(msg.peerId.userId);
  return null;
}

function chatIdString(msg: Api.Message): string {
  if (msg.peerId instanceof Api.PeerUser) return String(msg.peerId.userId);
  if (msg.peerId instanceof Api.PeerChat) return String(msg.peerId.chatId);
  if (msg.peerId instanceof Api.PeerChannel) return String(msg.peerId.channelId);
  return 'unknown';
}

export function attachMessageHandler(client: TelegramClient, config: MessageHandlerConfig): void {
  client.addEventHandler(
    (event: NewMessageEvent) => { void handleEvent(client, event, config); },
    new NewMessage({ incoming: true }),
  );
}

async function handleEvent(
  client: TelegramClient,
  event: NewMessageEvent,
  config: MessageHandlerConfig,
): Promise<void> {
  const msg = event.message;

  try {
    // ─── 防自我循环 第 1 道: 自己人白名单 ─────────────────────────
    const fromUserId = extractFromUserId(msg);
    const ownSet = config.getOwnNetwork?.();
    if (fromUserId && ownSet?.has(fromUserId)) {
      logger.debug(`[MessageHandler:${config.accountId}] skip — from own-network ${fromUserId}`);
      return;
    }
    // self 也跳过 (安全冗余)
    if (config.selfTgUserId && fromUserId === config.selfTgUserId) {
      return;
    }

    // ─── 防自我循环 第 2 道: 60s rate-limit per (account, chat) ──
    const chatId = chatIdString(msg);
    if (!consumeRateLimit(config.accountId, chatId)) {
      logger.warn(`[MessageHandler:${config.accountId}] rate-limit skip chat=${chatId}`);
      return;
    }

    if (config.role === 'cs') {
      await handleCsMessage(client, msg, config);
      return;
    }

    if (config.role === 'ad') {
      await handleAdMessage(client, msg, config);
      return;
    }

    // hybrid: not handled by default — Super Admin must explicitly configure
  } catch (err) {
    logger.error(`[MessageHandler:${config.accountId}] Unhandled error:`, err instanceof Error ? err : { err });
  }
}

async function handleCsMessage(
  client: TelegramClient,
  msg: Api.Message,
  config: MessageHandlerConfig,
): Promise<void> {
  const text = msg.text?.trim();
  if (!text) return;

  const chatId = String(
    msg.peerId instanceof Api.PeerUser
      ? msg.peerId.userId
      : msg.peerId instanceof Api.PeerChat
      ? msg.peerId.chatId
      : msg.peerId instanceof Api.PeerChannel
      ? msg.peerId.channelId
      : 'unknown',
  );

  if (config.aiReplyService) {
    const reply = await config.aiReplyService.reply(config.accountId, chatId, text);
    await client.sendMessage(msg.peerId, { message: reply, replyTo: msg.id });
    logger.info(`[CS:${config.accountId}] AI reply sent to chat ${chatId}`);
  } else {
    await client.sendMessage(msg.peerId, {
      message: 'Thanks for your message! Our team will get back to you shortly.',
      replyTo: msg.id,
    });
  }
}

async function handleAdMessage(
  client: TelegramClient,
  msg: Api.Message,
  config: MessageHandlerConfig,
): Promise<void> {
  const isPrivate = msg.peerId instanceof Api.PeerUser;

  if (isPrivate) {
    await client.sendMessage(msg.peerId, {
      message: `Hi! For assistance please contact our team: @${config.botUsername}`,
    });
    logger.info(`[AD:${config.accountId}] Diverted private DM to bot @${config.botUsername}`);
  } else if (msg.mentioned) {
    // Group / channel: reply only when directly mentioned to avoid spam
    await client.sendMessage(msg.peerId, {
      message: config.adGroupFaqReply,
      replyTo: msg.id,
    });
    logger.info(`[AD:${config.accountId}] Group FAQ reply sent`);
  }
}
