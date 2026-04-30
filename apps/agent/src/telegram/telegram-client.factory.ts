import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

export interface ProxyConfig {
  ip: string;
  port: number;
  socksType: 4 | 5;
  username?: string;
  password?: string;
}

export interface DeviceFingerprint {
  deviceModel: string;
  systemVersion: string;
  appVersion: string;
  langCode: string;
  systemLangCode: string;
}

export interface TelegramClientConfig {
  phoneNumber: string;
  sessionString: string;
  apiId: number;
  apiHash: string;
  proxy?: ProxyConfig;
  /**
   * 账号专属设备指纹。**必须**和绑号时使用的指纹完全一致 —
   * 否则 Telegram 会检测到"设备变化"并强制重新登录。
   * 由 server 端从 account.deviceFingerprint 读出后传过来。
   */
  deviceFingerprint: DeviceFingerprint;
}

export function createTelegramClient(config: TelegramClientConfig): TelegramClient {
  const session = new StringSession(config.sessionString);
  return new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    proxy: config.proxy,
    deviceModel: config.deviceFingerprint.deviceModel,
    systemVersion: config.deviceFingerprint.systemVersion,
    appVersion: config.deviceFingerprint.appVersion,
    langCode: config.deviceFingerprint.langCode || 'en',
    systemLangCode: config.deviceFingerprint.systemLangCode || 'en',
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
