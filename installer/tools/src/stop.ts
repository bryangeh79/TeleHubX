import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { loadSupervisorEnv } from './shared/env';
import { buildDataPaths } from './shared/paths';
import { log, setLogFile } from './shared/log';
import { readPidFile, deletePidFile, listPidFiles, type PidRecord } from './shared/pid-store';
import { getProcessInfo, killProcessTree, isPidAlive } from './shared/proc-windows';

/**
 * TeleHubX stop — 停止器（最高安全模式）
 *
 * !! 租户机器上可能并行运行其他 Node / Postgres / Redis / 浏览器 / 自动化程序。
 * !! 本工具绝对不能误杀任何非 TeleHubX 进程。
 *
 * 进程必须满足全部条件才允许 taskkill /PID <pid> /T /F:
 *   0) pid 文件路径在 <dataDir>/run/<service>.pid
 *   1) pid 文件 service 字段在白名单 SERVICE_WHITELIST 内
 *   2) pid 文件 service 字段与文件名一致（防 pid 文件被改名注入）
 *   3) PID 仍存活 (process.kill(pid, 0))
 *   4) ExecutablePath 在 installPath 下，或与 pid 文件 exe 完全一致
 *   5) CommandLine 包含 pid 文件 args 任一字符串（>=4 字符）
 *   6) CreationDate 与 startedAt 偏差 ≤ 5 秒（防 PID 复用）
 *
 * 任一步失败 → 跳过 + 写日志 + 不 taskkill。
 *
 * 严禁的操作（代码里没有，工具不允许）:
 *   - taskkill /F /IM node.exe / postgres.exe / redis.exe / memurai.exe
 *   - Stop-Process -Name node / pkill node / killall node
 *   - 任何按进程名批量杀
 *
 * 反向停止顺序: dashboard → agent → server → memurai → postgres
 *
 * dry-run: TELEHUBX_STOP_DRY_RUN=1 → 仅打印将做的事, 不实际 taskkill
 */

/** 服务白名单 — pid 文件 service 字段必须严格匹配此列表 */
const SERVICE_WHITELIST = ['dashboard', 'agent', 'server', 'memurai', 'postgres'] as const;
type ServiceName = typeof SERVICE_WHITELIST[number];

/** 反向停止顺序（dashboard 先停，避免新请求打到正停的 server） */
const STOP_ORDER: ServiceName[] = ['dashboard', 'agent', 'server', 'memurai', 'postgres'];

const CREATION_DRIFT_TOLERANCE_MS = 5000;

interface ValidationResult { ok: boolean; reason?: string }

function validateOwnership(expectedService: ServiceName, rec: PidRecord): ValidationResult {
  // 1) service 在白名单
  if (!SERVICE_WHITELIST.includes(rec.service as ServiceName)) {
    return { ok: false, reason: `service_not_whitelisted: ${rec.service}` };
  }

  // 2) service 字段与 pid 文件名一致（防 pid 文件被改名注入）
  if (rec.service !== expectedService) {
    return { ok: false, reason: `service_field_mismatch: file=${expectedService} field=${rec.service}` };
  }

  // 3) PID 仍存活
  if (!isPidAlive(rec.pid)) return { ok: false, reason: 'pid_not_alive' };

  // 4-6 require process info
  const info = getProcessInfo(rec.pid);
  if (!info) return { ok: false, reason: 'pid_query_failed' };

  // 4) exe 在 installPath 下，或与 pid 文件记录 exe 完全一致
  const exeNorm = (info.exePath ?? '').toLowerCase().replace(/\//g, '\\');
  const installNorm = rec.installPath.toLowerCase().replace(/\//g, '\\');
  const recordedExeNorm = rec.exe.toLowerCase().replace(/\//g, '\\');
  const exeOk = exeNorm.startsWith(installNorm) || exeNorm === recordedExeNorm;
  if (!exeOk) {
    return { ok: false, reason: `exe_outside_install (live=${info.exePath} expected_under=${rec.installPath} or exact=${rec.exe})` };
  }

  // 5) cmdLine 包含 pid 文件 args 任一字符串（>=4 字符，避免 -p 等短参误匹配）
  const cmdLineNorm = (info.cmdLine ?? '').toLowerCase().replace(/\//g, '\\');
  const matchAny = rec.args.some(a => {
    const an = a.toLowerCase().replace(/\//g, '\\');
    return an.length > 3 && cmdLineNorm.includes(an);
  });
  if (!matchAny) {
    return { ok: false, reason: `cmdline_mismatch (live=${(info.cmdLine ?? '').slice(0, 80)})` };
  }

  // 6) CreationDate 与 startedAt 偏差 ≤ 5 秒（防 PID 被系统复用给新进程）
  if (info.creationDate == null) return { ok: false, reason: 'creation_date_missing' };
  const drift = Math.abs(info.creationDate - rec.startedAt);
  if (drift > CREATION_DRIFT_TOLERANCE_MS) {
    return { ok: false, reason: `creation_drift_${drift}ms (likely pid_reuse)` };
  }

  return { ok: true };
}

async function main(): Promise<void> {
  const env = loadSupervisorEnv();
  const paths = buildDataPaths(env.dataDir);
  setLogFile(path.join(paths.logsDir, 'supervisor.log'));

  const dryRun = process.env.TELEHUBX_STOP_DRY_RUN === '1';
  log.info(`==== TeleHubX stop ${dryRun ? '(DRY-RUN) ' : ''}====`);
  log.info(`runDir=${paths.runDir}`);

  if (!existsSync(paths.runDir)) {
    log.warn('run dir missing — nothing to stop');
    return;
  }

  const summary = { killed: 0, skipped: 0, missing: 0, failed: 0 };

  for (const svcName of STOP_ORDER) {
    const rec = readPidFile(paths.runDir, svcName);
    if (!rec) {
      log.info(`[${svcName}] no pid file`);
      summary.missing++;
      continue;
    }

    log.info(`[${svcName}] validating pid=${rec.pid}`);
    const v = validateOwnership(svcName, rec);
    if (!v.ok) {
      log.warn(`[stop] SKIP ${svcName} pid=${rec.pid} reason=${v.reason}`);
      // 删除 stale pid 文件（仅在非 dry-run）—— 但若是 PID 复用嫌疑则保留供运维查
      if (!dryRun && !v.reason?.startsWith('creation_drift') && !v.reason?.startsWith('exe_outside_install')) {
        deletePidFile(paths.runDir, svcName);
      }
      summary.skipped++;
      continue;
    }

    if (dryRun) {
      log.info(`[${svcName}] DRY-RUN: would taskkill /PID ${rec.pid} /T /F`);
      summary.killed++;
      continue;
    }

    log.info(`[${svcName}] taskkill /PID ${rec.pid} /T /F`);
    const r = killProcessTree(rec.pid);
    if (r.ok) {
      log.info(`[${svcName}] killed pid=${rec.pid}`);
      deletePidFile(paths.runDir, svcName);
      summary.killed++;
    } else {
      log.error(`[${svcName}] taskkill failed pid=${rec.pid}: ${(r.stderr ?? '').trim()}`);
      summary.failed++;
    }
  }

  // 报告未识别的 .pid 文件（不删除，留给运维查看）
  for (const name of listPidFiles(paths.runDir)) {
    if (!STOP_ORDER.includes(name as typeof STOP_ORDER[number])) {
      log.warn(`unrecognized pid file: ${name}.pid (left in place)`);
    }
  }

  log.info(
    `==== stop summary: killed=${summary.killed} skipped=${summary.skipped} missing=${summary.missing} failed=${summary.failed} ====`,
  );
  process.exit(0);
}

main().catch(e => {
  log.error(`stop fatal: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
