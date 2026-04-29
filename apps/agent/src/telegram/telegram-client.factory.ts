import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

export interface ProxyConfig {
  ip: string;
  port: number;
  socksType: 4 | 5;
  username?: string;
  password?: string;
}

export interface TelegramClientConfig {
  phoneNumber: string;
  sessionString: string;
  apiId: number;
  apiHash: string;
  proxy?: ProxyConfig;
}

// Mimic Samsung SM-S928B running Telegram 10.14.2 — TG sees "mobile app login"
const DEVICE_FINGERPRINT = {
  deviceModel: 'Samsung SM-S928B',
  systemVersion: 'Android 14',
  appVersion: '10.14.2',
  langCode: 'en',
  systemLangCode: 'en',
};

export function createTelegramClient(config: TelegramClientConfig): TelegramClient {
  const session = new StringSession(config.sessionString);
  return new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    proxy: config.proxy,
    ...DEVICE_FINGERPRINT,
  });
}

export async function connectClient(client: TelegramClient): Promise<void> {
  await client.connect();
}

export async function disconnectClient(client: TelegramClient): Promise<void> {
  await client.disconnect();
}

export async function getMe(client: TelegramClient) {
  return client.getMe();
}

export function exportSession(client: TelegramClient): string {
  return (client.session as StringSession).save();
}
