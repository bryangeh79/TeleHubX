import { TelegramClient } from 'telegram';
import { logger } from '../logger';

export interface CampaignMessage {
  id: string;
  peer: string;
  text: string;
}

export interface Campaign {
  id: string;
  accountId: string;
  messages: CampaignMessage[];
}

// Hard minimum between sends: 1 msg / 5 s per account
const MSG_INTERVAL_MS = 5_000;
const FLOOD_WAIT_REGEX = /FLOOD_WAIT_(\d+)/;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class CampaignExecutor {
  private running = false;
  private queue: CampaignMessage[] = [];
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: TelegramClient,
    private readonly accountId: string,
    private readonly serverUrl: string,
    private readonly pollIntervalMs = 60_000,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info(`[Campaign:${this.accountId}] Executor started, polling every ${this.pollIntervalMs / 1000}s`);
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info(`[Campaign:${this.accountId}] Executor stopped`);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      const campaigns = await this.fetchPending();
      for (const c of campaigns) {
        this.queue.push(...c.messages);
      }
      if (this.queue.length > 0) {
        logger.info(`[Campaign:${this.accountId}] Draining ${this.queue.length} queued messages`);
        await this.drainQueue();
      }
    } catch (err) {
      logger.error(`[Campaign:${this.accountId}] Poll error:`, err instanceof Error ? err : { err });
    }
    this.pollTimer = setTimeout(() => { void this.poll(); }, this.pollIntervalMs);
  }

  private async fetchPending(): Promise<Campaign[]> {
    const url = `${this.serverUrl}/api/campaigns/pending?accountId=${encodeURIComponent(this.accountId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Server responded ${res.status} for campaigns fetch`);
    return res.json() as Promise<Campaign[]>;
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0 && this.running) {
      const msg = this.queue.shift()!;
      await this.sendWithRetry(msg);
      await sleep(MSG_INTERVAL_MS);
    }
  }

  private async sendWithRetry(msg: CampaignMessage): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.client.sendMessage(msg.peer, { message: msg.text });
        await this.reportSent(msg.id);
        logger.info(`[Campaign:${this.accountId}] Sent msg ${msg.id} to ${msg.peer}`);
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const floodMatch = FLOOD_WAIT_REGEX.exec(errMsg);
        if (floodMatch) {
          const waitSec = parseInt(floodMatch[1]!, 10);
          logger.warn(`[Campaign:${this.accountId}] FLOOD_WAIT ${waitSec}s — backing off`);
          await sleep(waitSec * 1_000);
          continue;
        }
        logger.warn(`[Campaign:${this.accountId}] Attempt ${attempt}/${MAX_ATTEMPTS} failed for msg ${msg.id}: ${errMsg}`);
        if (attempt < MAX_ATTEMPTS) await sleep(2_000 * attempt);
      }
    }
    logger.error(`[Campaign:${this.accountId}] Skipping msg ${msg.id} after ${MAX_ATTEMPTS} failed attempts`);
  }

  private async reportSent(msgId: string): Promise<void> {
    try {
      const url = `${this.serverUrl}/api/campaigns/messages/${encodeURIComponent(msgId)}/sent`;
      await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5_000) });
    } catch {
      // best-effort — server will reconcile via polling
    }
  }
}
