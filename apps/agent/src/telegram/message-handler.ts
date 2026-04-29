import { TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';
import { AiReplyService } from '../ai/ai-reply.service';
import { logger } from '../logger';

export type AccountRole = 'ad' | 'cs' | 'hybrid';

export interface MessageHandlerConfig {
  role: AccountRole;
  accountId: string;
  // Placeholder bot username for ad-account private divert message
  botUsername: string;
  // Short reply sent by ad account in group when directly mentioned
  adGroupFaqReply: string;
  // If provided, cs role uses AI to reply; otherwise falls back to a static ack
  aiReplyService?: AiReplyService;
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
