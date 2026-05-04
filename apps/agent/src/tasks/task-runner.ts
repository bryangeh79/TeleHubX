import { TelegramClient } from 'telegram';
import { EXECUTORS, ExecutorCtx } from './executors';
import { classifyError, ErrorClass } from './error-classifier';

export interface DispatchedTask {
  id: string;
  type: string;
  accountId: string | null;
  accountLabel: string | null;
  payload: Record<string, any> | null;
  tenantId?: string | null;
  /** Codex round-8: 已成功发送过消息的标记 (campaign_single retry 防重发) */
  messageSentAt?: string | null;
  /** Auto-Recovery: 已自动重试次数, 由 server dispatch 透传 */
  autoRetryCount?: number;
}

export interface ServerCallbacks {
  /** 报告进度 0-100 */
  updateProgress(taskId: string, progress: number): Promise<void>;
  /** 任务执行完成 */
  markDone(taskId: string): Promise<void>;
  /** 任务执行完成 + 写 errorMsg (用于 self-test 把 JSON 结果存入) */
  markDoneWithMsg(taskId: string, errorMsg: string): Promise<void>;
  /**
   * 任务执行失败。
   * Auto-Recovery: errorClass 可选, 由 task-runner 在分类后传入, server 写入 task.errorClass
   */
  markFailed(taskId: string, errorMsg: string, errorClass?: ErrorClass): Promise<void>;
  /** 触发 FloodWait → 把账号隔离一段时间 */
  quarantineAccount(accountId: string, untilEpochMs: number, reason: string): Promise<void>;
  /**
   * Auto-Recovery: 自动重试前调此回调, server 端原子 UPDATE autoRetryCount/errorClass/lastRetryAt.
   */
  markRetrying(taskId: string, errorClass: ErrorClass, count: number): Promise<void>;
  /**
   * Auto-Recovery: 重连账号 (B 类错误前置). 红线: 只允许 client.disconnect()/connect(),
   * 不允许重建 TelegramClient, 不允许清 session.
   * 返回 true 表示重连成功, false 表示失败 (此时 task 直接 markFailed).
   */
  reconnectAccount(accountId: string): Promise<boolean>;
  /**
   * Auto-Recovery: G 类账号失效 (AUTH_KEY_UNREGISTERED 等), 标账号 banned + 推送通知用户.
   * 失败静默 (不阻塞 task fail 流程).
   */
  markAccountBanned(accountId: string, reason: string): Promise<void>;
  /**
   * Codex #3: 多账号 executor (chat_script_*) 需要锁额外参与账号。
   * 主 task.accountId 由 main loop 自动锁；这里给 B/C/D/E/F 用。
   */
  lockExtraAccounts(accountIds: string[], taskId: string): void;
  unlockExtraAccounts(accountIds: string[]): void;
  /**
   * Codex #2: 查询任务是否被用户取消 (cancelRequested=true)。
   * Runner 启动后周期性 (30s) 调用此函数, true 时 abort 信号传给 executor.
   */
  isTaskCanceled(taskId: string): Promise<boolean>;
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
 * Codex round-9 #5: 某些 task 的耗时严重依赖 payload 数量, 静态 timeout 不够.
 * 此函数为这些 task 计算动态 timeout 上限, 调用方在 TASK_TIMEOUT_MS 静态值之外二次校准.
 */
function dynamicTimeoutMs(type: string, payload: any): number | null {
  const p = payload ?? {};
  switch (type) {
    case 'join_channels': {
      // 每频道 60-180s sleep + RPC, 给 N×3min + 60s buffer
      const n = Array.isArray(p.channels) ? p.channels.length : 0;
      if (n > 1) return n * 3 * 60_000 + 60_000;
      return null;
    }
    case 'join_groups': {
      const n = (Array.isArray(p.inviteLinks) ? p.inviteLinks.length : 0) +
                (Array.isArray(p.chatIds) ? p.chatIds.length : 0);
      // 静态 30min 已较宽; 仅 N>10 时扩
      if (n > 10) return n * 3 * 60_000 + 60_000;
      return null;
    }
    default:
      return null;
  }
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
    lockExtraAccounts: (ids: string[]) => cb.lockExtraAccounts(ids, task.id),
    unlockExtraAccounts: (ids: string[]) => cb.unlockExtraAccounts(ids),
    messageSentAt: task.messageSentAt ?? null,    // Codex round-8
  };

  // Codex round-9 #5: 静态 + 动态二取大, 让 N 频道/N 群任务时长足够
  const staticTimeout = TASK_TIMEOUT_MS[task.type] ?? DEFAULT_TIMEOUT_MS;
  const dynamicTimeout = dynamicTimeoutMs(task.type, task.payload);
  const timeoutMs = dynamicTimeout ? Math.max(staticTimeout, dynamicTimeout) : staticTimeout;

  cb.log.info(`[task ${task.id.slice(0, 8)}] start type=${task.type} account=${task.accountLabel ?? task.accountId?.slice(0, 8)}`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Codex #2: 30s 一次轮询 server, 用户取消 → abort signal → executor 在 cancellableSleep / RPC timeout 触发处优雅退出
  let cancelWatcher: ReturnType<typeof setInterval> | undefined;
  cancelWatcher = setInterval(async () => {
    try {
      const canceled = await cb.isTaskCanceled(task.id);
      if (canceled && !abortCtl.signal.aborted) {
        cb.log.warn(`[task ${task.id.slice(0, 8)}] cancelRequested=true detected mid-flight, aborting`);
        abortCtl.abort();
      }
    } catch { /* 网络错误忽略 */ }
  }, 30_000);

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
    if (cancelWatcher) clearInterval(cancelWatcher);

    // Codex Bug #4 修复: SELF_TEST 成功也走过 throw 流程, 走到这分支说明 executor 没 throw
    // 但实际 self_test 总会 throw (含成功 JSON), 所以这里 markDone 几乎用不到; 留作未来其他 executor 用
    await cb.markDone(task.id);
    cb.log.info(`[task ${task.id.slice(0, 8)}] done ✓`);
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (cancelWatcher) clearInterval(cancelWatcher);
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

    // ─── D 类: FloodWait 走原有 quarantine 路径 (红线: 不被新 retry 改坏) ────
    const floodSec = parseFloodWaitSeconds(e);
    if (floodSec && task.accountId) {
      const until = Date.now() + (floodSec + 30) * 1000; // 多加 30 秒 buffer
      await cb.quarantineAccount(task.accountId, until, `FloodWait ${floodSec}s @ task=${task.type}`);
      cb.log.warn(`[task ${task.id.slice(0, 8)}] FloodWait ${floodSec}s, quarantined account ${task.accountId.slice(0, 8)} until ${new Date(until).toISOString()}`);
      await cb.markFailed(task.id, e.message ?? String(err), 'D');
      return;
    }

    // ─── Auto-Recovery: 错误分类 + 自动重试 (仅 A/B 类) ──────────────────
    const classified = classifyError(e);

    // G 类: 账号失效 → 标账号 banned (不重试)
    if (classified.class === 'G' && task.accountId) {
      await cb.markAccountBanned(task.accountId, classified.classLabel).catch(() => {});
    }

    // A/B 类 + 重试上限未到 → 自动重试
    const MAX_AUTO_RETRY = 2;
    const currentCount = task.autoRetryCount ?? 0;
    if (classified.retryable && currentCount < MAX_AUTO_RETRY) {
      const nextCount = currentCount + 1;
      await cb.markRetrying(task.id, classified.class, nextCount).catch(() => {});

      // 退避: 30s × 2^(count-1) ± 20% jitter
      const baseBackoff = 30_000 * Math.pow(2, nextCount - 1);
      const jitterRange = baseBackoff * 0.2;
      const backoffMs = baseBackoff + (Math.random() * 2 - 1) * jitterRange;
      cb.log.info(
        `[task ${task.id.slice(0, 8)}] auto-retry ${nextCount}/${MAX_AUTO_RETRY} in ${Math.round(backoffMs / 1000)}s (class=${classified.class} ${classified.classLabel})`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));

      // B 类: 重试前 reconnect (红线: 只 connect/disconnect, 不重建 client)
      if (classified.needReconnect && task.accountId) {
        const ok = await cb.reconnectAccount(task.accountId).catch(() => false);
        if (!ok) {
          cb.log.error(`[task ${task.id.slice(0, 8)}] reconnect failed, abort retry`);
          await cb.markFailed(
            task.id,
            `[${classified.classLabel}] 重连失败 — ${e.message ?? String(err)}`,
            classified.class,
          );
          return;
        }
      }

      // 递归重试 — 注意保留 task.messageSentAt (campaign_single 幂等关键)
      // 红线: 必须传同一个 task object, 不可清 messageSentAt
      return executeTask(
        { ...task, autoRetryCount: nextCount },
        client,
        cb,
        clients,
      );
    }

    // ─── 不可重试 / 上限耗尽 → markFailed ────────────────────────────
    const finalMsg = classified.permanent
      ? `[${classified.classLabel}] ${e.message ?? String(err)}`
      : currentCount > 0
        ? `[${classified.classLabel}] 已自动重试 ${currentCount}/${MAX_AUTO_RETRY} — ${e.message ?? String(err)}`
        : `[${classified.classLabel}] ${e.message ?? String(err)}`;
    cb.log.error(`[task ${task.id.slice(0, 8)}] failed (class=${classified.class}): ${e.message}`);
    await cb.markFailed(task.id, finalMsg, classified.class);
  }
}
