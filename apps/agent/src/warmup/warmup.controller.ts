import { TelegramClient } from 'telegram';
import { logger } from '../logger';

export enum WarmupPhase {
  P0 = 0, // Online only — no messages, heartbeat only (2 h window)
  P1 = 1, // 5 msg/day, >=30 min gap
  P2 = 2, // 20 msg/day, group participation
  P3 = 3, // 50 msg/day, normal usage
  P4 = 4, // Production — full functionality, unlimited
}

export interface WarmupConfig {
  accountId: string;
  phase: WarmupPhase;
  contentPool?: string[];  // Messages to send during warmup
  groupPeers?: string[];   // Group usernames / IDs to send into
}

// Box-Muller Gaussian clamped to [min, max]
function gaussian(min: number, max: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const mid = (min + max) / 2;
  const stddev = (max - min) / 6;
  return Math.min(max, Math.max(min, mid + z * stddev));
}

// Max messages per day per phase (P4 = production, no warmup cap)
const DAILY_LIMIT: Record<number, number> = {
  [WarmupPhase.P0]: 0,
  [WarmupPhase.P1]: 5,
  [WarmupPhase.P2]: 20,
  [WarmupPhase.P3]: 50,
  [WarmupPhase.P4]: Number.POSITIVE_INFINITY,
};

// Minimum delay between messages in ms
const MIN_GAP_MS: Record<number, number> = {
  [WarmupPhase.P0]: 0,
  [WarmupPhase.P1]: 30 * 60_000,
  [WarmupPhase.P2]: 10 * 60_000,
  [WarmupPhase.P3]: 5 * 60_000,
  [WarmupPhase.P4]: 60_000,
};

export class WarmupController {
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private msgSentToday = 0;

  constructor(
    private readonly client: TelegramClient,
    private readonly config: WarmupConfig,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`[Warmup:${this.config.accountId}] Starting Phase ${this.config.phase}`);
    this.scheduleDailyReset();
    if (this.config.phase === WarmupPhase.P0) {
      logger.info(`[Warmup:${this.config.accountId}] Phase 0: silent observation — heartbeat only`);
      return;
    }
    this.scheduleNextMessage();
  }

  stop(): void {
    this.running = false;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    logger.info(`[Warmup:${this.config.accountId}] Stopped`);
  }

  getPhase(): WarmupPhase {
    return this.config.phase;
  }

  private scheduleDailyReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const ms = tomorrow.getTime() - now.getTime();
    const t = setTimeout(() => {
      this.msgSentToday = 0;
      logger.info(`[Warmup:${this.config.accountId}] Daily send counter reset`);
      this.scheduleDailyReset();
    }, ms);
    this.timers.push(t);
  }

  private scheduleNextMessage(): void {
    if (!this.running) return;
    const limit = DAILY_LIMIT[this.config.phase] ?? 0;
    if (this.msgSentToday >= limit) return;

    const minGap = MIN_GAP_MS[this.config.phase] ?? 60_000;
    const delay = gaussian(minGap, minGap * 2);

    const t = setTimeout(async () => {
      if (!this.running) return;
      if (this.msgSentToday >= (DAILY_LIMIT[this.config.phase] ?? 0)) return;
      await this.sendWarmupMessage();
      this.msgSentToday++;
      this.scheduleNextMessage();
    }, delay);
    this.timers.push(t);
  }

  private async sendWarmupMessage(): Promise<void> {
    const { groupPeers, contentPool, accountId, phase } = this.config;
    if (!groupPeers?.length || !contentPool?.length) {
      logger.warn(`[Warmup:${accountId}] No peers or content pool configured — skipping`);
      return;
    }
    const peer = groupPeers[Math.floor(Math.random() * groupPeers.length)]!;
    const content = contentPool[Math.floor(Math.random() * contentPool.length)]!;
    try {
      await this.client.sendMessage(peer, { message: content });
      logger.info(`[Warmup:${accountId}] Phase ${phase}: sent warmup message to ${peer}`);
    } catch (err) {
      logger.warn(`[Warmup:${accountId}] Send failed:`, err instanceof Error ? { msg: err.message } : { err });
    }
  }
}
