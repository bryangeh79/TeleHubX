import { TelegramClient } from 'telegram';
import { EXECUTORS, ExecutorCtx } from './executors';

export interface DispatchedTask {
  id: string;
  type: string;
  accountId: string | null;
  accountLabel: string | null;
  payload: Record<string, any> | null;
  tenantId?: string | null;
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

/** 各任务类型最长允许执行时间（ms）。超时视为失败。 */
const TASK_TIMEOUT_MS: Record<string, number> = {
  campaign_single:        10 * 60 * 1000,  // 10 分钟
  contact_add:            10 * 60 * 1000,
  group_scrape:           15 * 60 * 1000,  // 爬群稍长
  join_groups_by_keyword: 10 * 60 * 1000,
  chat_script_ab:         15 * 60 * 1000,
  chat_script_4p:         15 * 60 * 1000,
  media_photo:            10 * 60 * 1000,
  media_video:            10 * 60 * 1000,
  media_voice:            10 * 60 * 1000,
};
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 其他类型默认 10 分钟

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
  clients?: Map<string, TelegramClient>,
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
    taskId: task.id,
    accountId: task.accountId ?? undefined,
    tenantId: task.tenantId ?? undefined,
    clients,
  };

  const timeoutMs = TASK_TIMEOUT_MS[task.type] ?? DEFAULT_TIMEOUT_MS;

  cb.log.info(`[task ${task.id.slice(0, 8)}] start type=${task.type} account=${task.accountLabel ?? task.accountId?.slice(0, 8)}`);

  try {
    // 给每个任务加强制超时，防止 GramJS 网络调用无限挂起
    await Promise.race([
      exec(ctx),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`任务执行超时 (>${timeoutMs / 60000} 分钟)`)),
          timeoutMs,
        ),
      ),
    ]);
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
