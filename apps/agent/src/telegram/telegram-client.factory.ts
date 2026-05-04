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

/**
 * 全局默认 RPC 超时 (ms)。
 * 任何 GramJS 网络调用 (invoke / getEntity / getMessages 等内部 invoke) 超过此时长 → reject。
 * 60s 已对正常 TG RPC 宽松, FloodWait 等真实错误本身在几秒内 reject。
 *
 * 主要解决: proxy 半死 / TG WebSocket 间歇性丢包 / DC 迁移卡死 等场景下,
 * 单 RPC 无限 hang 拖死整个 task 和共享 client (#88 → #93 雪崩根因)。
 */
const RPC_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 把 client.invoke 包成有超时的版本。所有上层 RPC 调用 (getEntity/getMessages/sendFile/sendMessage 等)
 * 内部都走 invoke, 因此一处 patch 就能保护全部。
 */
function patchClientWithRpcTimeout(client: TelegramClient): void {
  const original = client.invoke.bind(client);
  (client as any).invoke = async function patchedInvoke(request: any) {
    const label = request?.className ?? request?.constructor?.name ?? 'unknown';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        original(request),
        new Promise((_, rej) => {
          timer = setTimeout(
            () => rej(new Error(`RPC timeout (${RPC_DEFAULT_TIMEOUT_MS}ms): ${label}`)),
            RPC_DEFAULT_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export function createTelegramClient(config: TelegramClientConfig): TelegramClient {
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    proxy: config.proxy,
    deviceModel: config.deviceFingerprint.deviceModel,
    systemVersion: config.deviceFingerprint.systemVersion,
    appVersion: config.deviceFingerprint.appVersion,
    langCode: config.deviceFingerprint.langCode || 'en',
    systemLangCode: config.deviceFingerprint.systemLangCode || 'en',
  });
  patchClientWithRpcTimeout(client);
  return client;
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
