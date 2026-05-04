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
  /** 任务执行完成 + 写 errorMsg (用于 self-test 把 JSON 结果存入) */
  markDoneWithMsg(taskId: string, errorMsg: string): Promise<void>;
  /** 任务执行失败 */
  markFailed(taskId: string, errorMsg: string): Promise<void>;
  /** 触发 FloodWait → 把账号隔离一段时间 */
  quarantineAccount(accountId: string, untilEpochMs: number, reason: string): Promise<void>;
  /** 日志 */
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

/**
 * 各任务类型最长允许执行时间（ms）。超时视为失败。
 * 调小到 task type 可承受的实际上限：网络抖动 60s 内单 RPC 应该已 fail，
 * 整个 task 不该需要超过这些预算。
 */
// Codex Bug #2: 任务级 timeout 必须 ≥ executor 内最长间隔 × 步数 +RPC 开销
// 否则会出现 "任务做了一半被 timeout 误杀" 的情况
const TASK_TIMEOUT_MS: Record<string, number> = {
  idle_keepalive:          2 * 60 * 1000,
  profile_update:          2 * 60 * 1000,
  browse_channel:          5 * 60 * 1000,
  reaction_boost:          5 * 60 * 1000,
  join_channels:           5 * 60 * 1000,
  // group_bubble: 默认 count 3-6 × 5-30min sleep ≈ 90min 上限 → 给 2h
  group_bubble:           2 * 60 * 60 * 1000,
  accept_invites:          5 * 60 * 1000,
  post_channel:           10 * 60 * 1000,
  // group_scrape: N 群 × 10-30min sleep, N=3 → 90min 上限 → 给 2h
  group_scrape:           2 * 60 * 60 * 1000,
  // join_groups: N 群 × 1-3min sleep, N=5 → 15min → 给 30min
  join_groups:            30 * 60 * 1000,
  // join_groups_by_keyword: 5 群 × 5-15min sleep ≈ 75min → 给 90min
  join_groups_by_keyword: 90 * 60 * 1000,
  discover_groups_by_keyword: 10 * 60 * 1000,  // 只搜不加, 10min 够
  // contact_add: maxPerDay 默认 3 × 3-10min ≈ 30min → 给 60min
  contact_add:            60 * 60 * 1000,
  group_create:            5 * 60 * 1000,
  group_invite_members:   30 * 60 * 1000,
  // campaign_single: targets × variants × 1-5min, 假设 30 个目标 → 给 3h
  campaign_single:         3 * 60 * 60 * 1000,
  chat_script_ab:         30 * 60 * 1000,
  chat_script_4p:         30 * 60 * 1000,
  chat_script_6p:         30 * 60 * 1000,
  media_photo:            10 * 60 * 1000,
  media_video:            10 * 60 * 1000,
  media_voice:            10 * 60 * 1000,
  self_test:               5 * 60 * 1000,
};
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 默认 5 分钟（比原来的 10 紧）

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

  // Codex Bug #1 修复: AbortController 用于在 task-level timeout 时通知 executor 主动停下
  const abortCtl = new AbortController();

  const ctx: ExecutorCtx = {
    client,
    payload: task.payload ?? {},
    reportProgress: (pct) => cb.updateProgress(task.id, pct).catch(() => {}),
    taskId: task.id,
    accountId: task.accountId ?? undefined,
    tenantId: task.tenantId ?? undefined,
    clients,
    abortSignal: abortCtl.signal,
  };

  const timeoutMs = TASK_TIMEOUT_MS[task.type] ?? DEFAULT_TIMEOUT_MS;

  cb.log.info(`[task ${task.id.slice(0, 8)}] start type=${task.type} account=${task.accountLabel ?? task.accountId?.slice(0, 8)}`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 给每个任务加强制超时，防止 GramJS 网络调用无限挂起
    // 同时 abort signal 通知 executor 在下次检查点优雅退出
    await Promise.race([
      exec(ctx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abortCtl.abort();
          reject(new Error(`任务执行超时 (>${timeoutMs / 60000} 分钟)`));
        }, timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);

    // Codex Bug #4 修复: SELF_TEST 成功也走过 throw 流程, 走到这分支说明 executor 没 throw
    // 但实际 self_test 总会 throw (含成功 JSON), 所以这里 markDone 几乎用不到; 留作未来其他 executor 用
    await cb.markDone(task.id);
    cb.log.info(`[task ${task.id.slice(0, 8)}] done ✓`);
  } catch (err) {
    if (timer) clearTimeout(timer);
    abortCtl.abort();  // 让仍在跑的 executor 在下个检查点退出
    const e = err as Error;

    // Codex Bug #4 修复: SELF_TEST 总以 throw + JSON 结束, 区分对待
    if (task.type === 'self_test') {
      const msg = e.message ?? String(err);
      try {
        const parsed = JSON.parse(msg);
        if (parsed && Array.isArray(parsed.results)) {
          // 成功结果 → markDone, errorMsg 仍存 JSON 让 UI 解析
          if (parsed.failed === 0) {
            await cb.markDoneWithMsg(task.id, msg);
            cb.log.info(`[task ${task.id.slice(0, 8)}] self-test ✓ all ${parsed.passed} passed`);
            return;
          }
          // 失败 → markFailed, errorMsg 也是 JSON
          await cb.markFailed(task.id, msg);
          cb.log.warn(`[task ${task.id.slice(0, 8)}] self-test ${parsed.failed}/${parsed.passed + parsed.failed} failed`);
          return;
        }
      } catch { /* 不是 JSON, 走通用 failed */ }
    }

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
