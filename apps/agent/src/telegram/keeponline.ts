import { TelegramClient } from 'telegram';
import { Api } from 'telegram';

const MIN_MS = 30_000;
const MAX_MS = 60_000;

// Box-Muller Gaussian clamped to [min, max]
function gaussianInterval(min: number, max: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const mid = (min + max) / 2;
  const stddev = (max - min) / 6;
  return Math.min(max, Math.max(min, mid + z * stddev));
}

export class KeepOnlineService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(client: TelegramClient): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await client.invoke(new Api.account.UpdateStatus({ offline: false }));
      } catch {
        // transient failure — next tick will retry
      }
      const delay = gaussianInterval(MIN_MS, MAX_MS);
      this.timer = setTimeout(tick, delay);
    };
    tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
