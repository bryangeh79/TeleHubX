import { createHash, randomBytes } from 'crypto';

/**
 * 每个 TG 账号必须有独一无二的设备指纹，避免被关联到同一台设备。
 * 字段对应 GramJS / TelegramClient 构造参数，最终发到 Telegram 的 initConnection。
 */
export interface DeviceFingerprint {
  deviceModel: string;
  systemVersion: string;
  appVersion: string;
  langCode: string;
  systemLangCode: string;
}

/** 真实在售的 Android 旗舰/中端机型池（2024-2026 主流，TG 看着像活人手机）。 */
const DEVICE_MODELS = [
  'Samsung SM-S928B',     // Galaxy S24 Ultra
  'Samsung SM-S921B',     // Galaxy S24
  'Samsung SM-S918B',     // Galaxy S23 Ultra
  'Samsung SM-A546B',     // Galaxy A54
  'Samsung SM-A536B',     // Galaxy A53
  'Google Pixel 8 Pro',
  'Google Pixel 8',
  'Google Pixel 7 Pro',
  'Google Pixel 7',
  'Xiaomi 14 Pro',
  'Xiaomi 13T Pro',
  'Xiaomi 23116PN5BC',     // 14 Ultra
  'OnePlus 12',
  'OnePlus 11 5G',
  'realme RMX3850',         // GT 5 Pro
  'OPPO CPH2557',           // Find X7
  'vivo V2329A',            // X100 Pro
  'HUAWEI ALN-AL00',        // Mate 60 Pro
  'HONOR ALI-AN00',         // 100 Pro
];

const ANDROID_VERSIONS = ['Android 14', 'Android 13', 'Android 12'];
const TG_APP_VERSIONS = [
  '10.14.2', '10.14.1', '10.14.0',
  '10.13.4', '10.13.3', '10.13.2', '10.13.0',
  '10.12.0', '10.11.2',
];

/** 弱伪随机：在 [0, n) 范围内基于 seed 字节挑一个稳定的下标。 */
function pickFromSeed(seed: Buffer, idx: number, mod: number): number {
  return seed[idx % seed.length] % mod;
}

/**
 * 基于 accountId（uuid）生成稳定且唯一的设备指纹。
 * 同一个 accountId 多次调用结果相同 → 重连不会换设备 → TG 不会触发"新设备登录"邮件。
 */
export function generateDeviceFingerprint(accountId?: string): DeviceFingerprint {
  // 用 accountId 哈希做种子；没传 id（极少数情况）则用真随机
  const seed = accountId
    ? createHash('sha256').update(accountId).digest()
    : randomBytes(32);

  return {
    deviceModel: DEVICE_MODELS[pickFromSeed(seed, 0, DEVICE_MODELS.length)],
    systemVersion: ANDROID_VERSIONS[pickFromSeed(seed, 8, ANDROID_VERSIONS.length)],
    appVersion: TG_APP_VERSIONS[pickFromSeed(seed, 16, TG_APP_VERSIONS.length)],
    langCode: 'en',
    systemLangCode: 'en',
  };
}
