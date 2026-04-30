/**
 * BehaviorSimulator v2 — 模拟真人在使用 TG 的细节。
 *
 * 核心三件事：
 *   1. Gaussian 间隔（不是固定 timer）
 *   2. 输入指示器 (`messages.SetTyping action=typing`)
 *   3. 字符级延迟（按字数算"打字速度"）
 *
 * 所有时长都加随机抖动，避免被风控按"机器人节奏"识别。
 */

import { Api, type TelegramClient } from 'telegram';

/** 高斯近似（Box-Muller 转换），mean=0 sigma=1。 */
function gaussian(): number {
  const u1 = 1 - Math.random();
  const u2 = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** 在 [minMs, maxMs] 间产生一个高斯采样，取中间值附近最常见。 */
export function gaussianDelayMs(minMs: number, maxMs: number): number {
  const mean = (minMs + maxMs) / 2;
  const sigma = (maxMs - minMs) / 6; // 6 sigma 覆盖范围
  const v = mean + gaussian() * sigma;
  return Math.max(minMs, Math.min(maxMs, Math.round(v)));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 按字符数算"打字时长"：60-100ms/字 + Gaussian 抖动 */
export function typingDurationMs(text: string): number {
  const baseMsPerChar = 70 + (gaussian() * 15); // ~55-85ms/char
  return Math.max(800, Math.min(15000, text.length * baseMsPerChar));
}

/**
 * 模拟"正在输入..."然后发送消息。
 * - 显示 typing 指示器（对方能看到 "xxx 正在输入..."）
 * - 等待估算的打字时长
 * - 然后调用 sendMessage
 *
 * peer: InputPeer (用 client.getInputEntity(target) 拿到)
 */
export async function sendMessageLikeHuman(
  client: TelegramClient,
  peer: any,
  text: string,
  opts: { skipTyping?: boolean } = {},
): Promise<void> {
  if (!opts.skipTyping) {
    try {
      await client.invoke(
        new Api.messages.SetTyping({
          peer,
          action: new Api.SendMessageTypingAction(),
        }),
      );
    } catch {
      // setTyping 失败不阻碍发送（有些场景如 channel 无法设）
    }
    await sleep(typingDurationMs(text));
  }
  await client.sendMessage(peer, { message: text });
}

/**
 * 模拟"阅读"消息：进群/进频道后，停留 N 秒像真人在看，然后才执行下一动作。
 */
export async function simulateReading(minSec = 5, maxSec = 20): Promise<void> {
  await sleep(gaussianDelayMs(minSec * 1000, maxSec * 1000));
}

/**
 * 任务间间隔（每个原子任务执行完后等一下再做下一个）。
 * 默认 30-120 秒。
 */
export async function interTaskDelay(minSec = 30, maxSec = 120): Promise<void> {
  await sleep(gaussianDelayMs(minSec * 1000, maxSec * 1000));
}
