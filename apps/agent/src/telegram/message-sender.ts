import { TelegramClient } from 'telegram';
import type { EntityLike } from 'telegram/define';

export async function sendText(
  client: TelegramClient,
  peer: EntityLike,
  text: string,
): Promise<void> {
  await client.sendMessage(peer, { message: text });
}

export async function sendPhoto(
  client: TelegramClient,
  peer: EntityLike,
  filePath: string,
  caption?: string,
): Promise<void> {
  await client.sendFile(peer, {
    file: filePath,
    caption,
    forceDocument: false,
  });
}

export async function sendVideo(
  client: TelegramClient,
  peer: EntityLike,
  filePath: string,
  caption?: string,
): Promise<void> {
  await client.sendFile(peer, {
    file: filePath,
    caption,
    forceDocument: false,
  });
}

// Generic document / file (force raw download, no media preview)
export async function sendFile(
  client: TelegramClient,
  peer: EntityLike,
  filePath: string,
  caption?: string,
): Promise<void> {
  await client.sendFile(peer, {
    file: filePath,
    caption,
    forceDocument: true,
  });
}
