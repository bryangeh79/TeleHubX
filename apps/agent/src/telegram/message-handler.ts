import { TelegramClient } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram';

export type AccountRole = 'ad' | 'cs' | 'hybrid';

export interface MessageHandlerConfig {
  role: AccountRole;
  // Placeholder bot username for ad-account private divert message
  botUsername: string;
  // Short reply sent by ad account in group when someone tags/mentions it
  adGroupFaqReply: string;
}

export function attachMessageHandler(client: TelegramClient, config: MessageHandlerConfig): void {
  client.addEventHandler(
    (event: NewMessageEvent) => handleEvent(client, event, config),
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
      // Phase 2: wire AI reply / FAQ here
      return;
    }

    if (config.role === 'ad') {
      const isPrivate = msg.peerId instanceof Api.PeerUser;
      if (isPrivate) {
        await client.sendMessage(msg.peerId, {
          message: `Hi! For assistance please contact our team: @${config.botUsername}`,
        });
      } else {
        // Group or channel — send a brief FAQ reply only when directly mentioned
        if (msg.mentioned) {
          await client.sendMessage(msg.peerId, {
            message: config.adGroupFaqReply,
            replyTo: msg.id,
          });
        }
      }
    }

    // hybrid: not handled by default — Super Admin must explicitly configure
  } catch (err) {
    console.error('[MessageHandler] Error handling message:', err);
  }
}
