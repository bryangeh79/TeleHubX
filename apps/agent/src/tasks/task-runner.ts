import { TelegramClient } from 'telegram';
import { EXECUTORS, ExecutorCtx } from './executors';

export interface DispatchedTask {
  id: string;
  type: string;
  accountId: string | null;
  accountLabel: string | null;
  payload: Record<string, any> | null;
}

export interface ServerCallbacks {
  /** 报告进度 0-100 */
  updateProgress(taskId: string, progress: number): Promise<void>;
  /** 任务执行完成 */
  markDone(taskId: string): Promise<void>;
  /** 任务执行失败 */
  markFailed(taskId: string, errorMsg: string): Promise<void>;
  /** 触发 FloodWait → 把账号隔离一段时间 */
  quarantineAccount(accountId: string, untilEpochMs: number, reason: string): Promise<void>;
  /** 日志 */
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

/**
 * 解析 GramJS 错误，识别 FloodWait（应该隔离账号一段时间）。
 * GramJS 的 FloodWait 错误消息格式：'A wait of N seconds is required (caused by ...)'.
 */
function parseFloodWaitSeconds(err: Error): number | null {
  const msg = err.message ?? '';
  const m = /A wait of (\d+) seconds/i.exec(msg);
  if (m) return parseInt(m[1], 10);
  // 中文/其他变体
  const m2 = /FLOOD_WAIT_(\d+)/i.exec(msg);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

export async function executeTask(
  task: DispatchedTask,
  client: TelegramClient,
  cb: ServerCallbacks,
): Promise<void> {
  const exec = EXECUTORS[task.type];
  if (!exec) {
    await cb.markFailed(task.id, `No executor registered for type=${task.type}`);
    return;
  }

  const ctx: ExecutorCtx = {
    client,
    payload: task.payload ?? {},
    reportProgress: (pct) => cb.updateProgress(task.id, pct).catch(() => {}),
  };

  cb.log.info(`[task ${task.id.slice(0, 8)}] start type=${task.type} account=${task.accountLabel ?? task.accountId?.slice(0, 8)}`);

  try {
    await exec(ctx);
    await cb.markDone(task.id);
    cb.log.info(`[task ${task.id.slice(0, 8)}] done ✓`);
  } catch (err) {
    const e = err as Error;
    const floodSec = parseFloodWaitSeconds(e);
    if (floodSec && task.accountId) {
      const until = Date.now() + (floodSec + 30) * 1000; // 多加 30 秒 buffer
      await cb.quarantineAccount(task.accountId, until, `FloodWait ${floodSec}s @ task=${task.type}`);
      cb.log.warn(`[task ${task.id.slice(0, 8)}] FloodWait ${floodSec}s, quarantined account ${task.accountId.slice(0, 8)} until ${new Date(until).toISOString()}`);
    } else {
      cb.log.error(`[task ${task.id.slice(0, 8)}] failed: ${e.message}`);
    }
    await cb.markFailed(task.id, e.message ?? String(err));
  }
}
