import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { loadSupervisorEnv } from './shared/env';
import { buildDataPaths } from './shared/paths';
import { log, setLogFile } from './shared/log';
import { readPidFile, deletePidFile, listPidFiles, type PidRecord } from './shared/pid-store';
import { getProcessInfo, killProcessTree, isPidAlive } from './shared/proc-windows';

/**
 * TeleHubX stop — 停止器
 *
 * 严格四步 PID 校验，保证只杀属于本安装的进程：
 *   1) PID 仍存活
 *   2) ExecutablePath 在 installPath 下（或与 pid 文件记录的 exe 完全一致）
 *   3) CommandLine 包含 pid 文件记录的 args 中任一字符串
 *   4) 进程 CreationDate 与 startedAt 偏差 ≤ 5 秒
 *
 * 失败任一步 → 跳过 + 写日志 + 删 pid 文件，绝不 taskkill。
 *
 * 反向停止顺序: dashboard → agent → server → memurai → postgres
 *
 * dry-run: 设置 TELEHUBX_STOP_DRY_RUN=1 → 仅打印将做的事, 不实际 taskkill
 */

const STOP_ORDER: Array<'dashboard' | 'agent' | 'server' | 'memurai' | 'postgres'> = [
  'dashboard', 'agent', 'server', 'memurai', 'postgres',
];

const CREATION_DRIFT_TOLERANCE_MS = 5000;

interface ValidationResult { ok: boolean; reason?: string }

function validateOwnership(rec: PidRecord): ValidationResult {
  // 1) PID alive
  if (!isPidAlive(rec.pid)) return { ok: false, reason: 'pid_not_alive' };

  // 2-4 require process info
  const info = getProcessInfo(rec.pid);
  if (!info) return { ok: false, reason: 'pid_query_failed' };

  // 2) exe in install path (case-insensitive)
  const exeNorm = (info.exePath ?? '').toLowerCase().replace(/\//g, '\\');
  const installNorm = rec.installPath.toLowerCase().replace(/\//g, '\\');
  const recordedExeNorm = rec.exe.toLowerCase().replace(/\//g, '\\');
  const exeOk = exeNorm.startsWith(installNorm) || exeNorm === recordedExeNorm;
  if (!exeOk) {
    return { ok: false, reason: `exe_outside_install (live=${info.exePath} expected_under=${rec.installPath})` };
  }

  // 3) cmdLine matches any recorded arg
  const cmdLineNorm = (info.cmdLine ?? '').toLowerCase().replace(/\//g, '\\');
  const matchAny = rec.args.some(a => {
    const an = a.toLowerCase().replace(/\//g, '\\');
    return an.length > 3 && cmdLineNorm.includes(an);
  });
  if (!matchAny) {
    return { ok: false, reason: `cmdline_mismatch (live=${(info.cmdLine ?? '').slice(0, 80)})` };
  }

  // 4) creation date drift
  if (info.creationDate == null) return { ok: false, reason: 'creation_date_missing' };
  const drift = Math.abs(info.creationDate - rec.startedAt);
  if (drift > CREATION_DRIFT_TOLERANCE_MS) {
    return { ok: false, reason: `creation_drift_${drift}ms` };
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
    const v = validateOwnership(rec);
    if (!v.ok) {
      log.warn(`[${svcName}] SKIP (${v.reason}) pid=${rec.pid}`);
      // 删除 stale pid 文件
      if (!dryRun) deletePidFile(paths.runDir, svcName);
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
