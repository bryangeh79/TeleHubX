import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync, readdirSync } from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { loadSupervisorEnv, type SupervisorEnv } from './shared/env';
import { buildDataPaths, type DataPaths } from './shared/paths';
import { log, setLogFile } from './shared/log';
import { writePidFile, readPidFile, deletePidFile, type PidRecord } from './shared/pid-store';
import { getProcessInfo, isPidAlive } from './shared/proc-windows';
import { spawnSync as ssync } from 'node:child_process';

/**
 * TeleHubX supervisor — startup orchestrator
 *
 * Modes:
 *   prod  : starts postgres + redis + server + agent + dashboard (5 services)
 *   dev   : assumes external PG/Redis (Docker), starts only server/agent/dashboard
 *   probe : no spawn; just probes ports + checks license + opens browser
 *
 * Issue #14 vmfix6 hardening:
 *   - Bootstrap lock at <runDir>/supervisor.lock prevents concurrent Start
 *   - Stale pid cleanup before any service start
 *   - Unified DB env (PG_*, DB_*, DATABASE_URL) propagated to all children
 *   - Server health timeout produces diagnostic dump (no hand-grepping)
 *   - init-pgdata is now truly idempotent and self-cleans temp postgres
 */

interface ServiceDef {
  name: 'postgres' | 'redis' | 'server' | 'agent' | 'dashboard';
  exe: string;
  args: string[];
  cwd?: string;
  enabledIn: ('dev' | 'prod')[];
  health: () => Promise<boolean>;
  healthTimeoutMs: number;
  critical: boolean;
  // vmfix19 (Issue #26): when true, this service is started via pg_ctl
  // (which calls CreateRestrictedToken to drop Administrators membership
  // before launching postgres.exe). Direct spawn() would inherit the
  // supervisor's token verbatim, and on Windows configs where that token
  // happens to carry BUILTIN\Administrators, postgres's own anti-privilege
  // check (`pgwin32_is_admin()`) refuses to start. pg_ctl is the
  // PostgreSQL-supported way to drop those privileges in-process.
  pgCtl?: boolean;
}

// ── network probes ─────────────────────────────────────────────────────────
function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

function httpProbe(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      res.resume();
      const code = res.statusCode ?? 0;
      resolve(code >= 200 && code < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitFor(
  probe: () => Promise<boolean>,
  label: string,
  totalMs: number,
  intervalMs = 1000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    if (await probe()) {
      log.info(`[${label}] ready (${Date.now() - start}ms)`);
      return true;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// ── service catalog ────────────────────────────────────────────────────────
function buildServices(env: SupervisorEnv, paths: DataPaths): ServiceDef[] {
  const portableNode = path.join(env.installPath, 'runtime', 'node', 'node.exe');
  const node = existsSync(portableNode) ? portableNode : process.execPath;

  return [
    {
      name: 'postgres',
      // vmfix19 (Issue #26): launch via pg_ctl so it can drop Administrators
      // membership (CreateRestrictedToken) before spawning postgres.exe.
      // Direct postgres.exe spawn was rejected with
      // "Execution of PostgreSQL by a user with administrative permissions
      //  is not permitted" when supervisor's token had Administrators (which
      // can happen on some Windows configs even when SCM identity is set
      // to LocalService).
      exe: path.join(env.installPath, 'runtime', 'postgres', 'bin', 'pg_ctl.exe'),
      args: [
        'start',
        '-D', paths.pgdataDir,
        '-l', path.join(paths.logsDir, 'postgres.log'),  // pg_ctl handles log redirect
        '-w',                                              // wait for ready
        '-t', '60',                                        // ready timeout
        '-o', `-p ${env.pgPort} -h 127.0.0.1`,            // pass-through to postgres
      ],
      enabledIn: ['prod'],
      health: () => tcpProbe('127.0.0.1', env.pgPort),
      healthTimeoutMs: 30000,
      critical: true,
      pgCtl: true,
    },
    {
      name: 'redis',
      exe: path.join(env.installPath, 'runtime', 'redis', 'redis-server.exe'),
      args: [
        path.join(env.installPath, 'runtime', 'redis', 'redis.conf'),
        '--bind', '127.0.0.1',
        '--port', String(env.redisPort),
        '--dir', paths.redisDataDir,
      ],
      enabledIn: ['prod'],
      health: () => tcpProbe('127.0.0.1', env.redisPort),
      healthTimeoutMs: 15000,
      critical: true,
    },
    {
      name: 'server',
      exe: node,
      args: [path.join(env.installPath, 'apps', 'server', 'dist', 'main.js')],
      cwd: path.join(env.installPath, 'apps', 'server'),
      enabledIn: ['dev', 'prod'],
      health: () => serverHealthProbe(env.appPort),
      healthTimeoutMs: 60000,
      critical: true,
    },
    {
      name: 'agent',
      exe: node,
      args: [path.join(env.installPath, 'apps', 'agent', 'dist', 'main.js')],
      cwd: path.join(env.installPath, 'apps', 'agent'),
      enabledIn: ['dev', 'prod'],
      health: async () => true,
      healthTimeoutMs: 1000,
      critical: false,
    },
    {
      name: 'dashboard',
      exe: node,
      args: [path.join(env.installPath, 'apps', 'dashboard', 'serve.cjs')],
      cwd: path.join(env.installPath, 'apps', 'dashboard'),
      enabledIn: ['dev', 'prod'],
      health: () => httpProbe(`http://127.0.0.1:${env.dashboardPort}`),
      healthTimeoutMs: 15000,
      critical: false,
    },
  ];
}

// ── unified subprocess env (Issue #14 vmfix6 §2) ───────────────────────────
/**
 * Build the env passed to every spawned child.
 *
 * All DB-related variants are populated from the same source values so server
 * (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME), agent (PG_*), and any third-party
 * lib (DATABASE_URL) all hit the same instance.
 *
 * DATABASE_URL is constructed but the password value is *redacted* before any
 * line of supervisor.log gets written; logger redaction in shared/log.ts
 * already covers DB_PASSWORD/PG_PASSWORD/DATABASE_URL key names.
 */
function subprocessEnv(env: SupervisorEnv): NodeJS.ProcessEnv {
  const PG_HOST     = process.env.PG_HOST     ?? process.env.DB_HOST     ?? '127.0.0.1';
  const PG_USER     = process.env.PG_USER     ?? process.env.DB_USER     ?? 'telehubx';
  const PG_PASSWORD = process.env.PG_PASSWORD ?? process.env.DB_PASSWORD ?? 'telehubx';
  const PG_DATABASE = process.env.PG_DATABASE ?? process.env.DB_NAME     ?? 'telehubx';
  const DATABASE_URL = `postgresql://${encodeURIComponent(PG_USER)}:${encodeURIComponent(PG_PASSWORD)}@${PG_HOST}:${env.pgPort}/${encodeURIComponent(PG_DATABASE)}`;

  return {
    ...process.env,

    TELEHUBX_INSTALL_PATH: env.installPath,
    TELEHUBX_DATA_DIR:     env.dataDir,
    TELEHUBX_RUNTIME_MODE: env.runtimeMode,

    APP_PORT:       String(env.appPort),
    DASHBOARD_PORT: String(env.dashboardPort),
    LICENSE_SERVER_URL: env.licenseServerUrl,

    // Postgres — both PG_* and DB_* aliases for max compatibility
    PG_HOST,
    PG_PORT:     String(env.pgPort),
    PG_USER,
    PG_PASSWORD,
    PG_DATABASE,
    DB_HOST:     PG_HOST,
    DB_PORT:     String(env.pgPort),
    DB_USER:     PG_USER,
    DB_USERNAME: PG_USER,
    DB_PASSWORD: PG_PASSWORD,
    DB_NAME:     PG_DATABASE,
    DATABASE_NAME: PG_DATABASE,
    DATABASE_URL,

    // Redis
    REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1',
    REDIS_PORT: String(env.redisPort),

    // vmfix7 (Issue #14): default CORS_ORIGINS for the bundled local dashboard
    // so server's prod-mode CORS guard never refuses the only legit origin.
    CORS_ORIGINS: process.env.CORS_ORIGINS
      ?? `http://127.0.0.1:${env.dashboardPort},http://localhost:${env.dashboardPort}`,

    // vmfix10 (Issue #16): UNCONDITIONALLY force TYPEORM_SYNC=true in prod mode.
    // vmfix8 used '?? "true"' which respects supervisor's existing process.env
    // value — but loadSupervisorEnv reads TYPEORM_SYNC from installer .env first,
    // so any 'TYPEORM_SYNC=false' there silently propagates to children and
    // schema never gets created. Override is required.
    //
    // Hosted/SaaS deployments don't run this supervisor; they invoke server
    // directly with their own env (where TYPEORM_SYNC is set to false + migrations).
    // Therefore an unconditional 'true' here is safe for the installer scenario
    // and only the installer scenario.
    TYPEORM_SYNC: env.runtimeMode === 'prod' ? 'true' : (process.env.TYPEORM_SYNC ?? 'false'),
  };
}

/** Try /health first (no global prefix), fall back to /api/v1/health. */
async function serverHealthProbe(appPort: number): Promise<boolean> {
  if (await httpProbe(`http://127.0.0.1:${appPort}/health`)) return true;
  return httpProbe(`http://127.0.0.1:${appPort}/api/v1/health`);
}

// vmfix12 / Issue #19: track active children so SIGTERM handler can kill them
const activeChildren = new Map<string, import('node:child_process').ChildProcess>();

// vmfix19 (Issue #26): when postgres is started via pg_ctl, supervisor doesn't
// have a ChildProcess handle (pg_ctl exits after starting postgres in the
// background). gracefulShutdown calls this function to issue `pg_ctl stop`
// instead of trying to kill a non-existent child. Set inside spawnPgCtlPostgres.
let postgresStopHandler: (() => void) | null = null;

// ── spawn helpers ──────────────────────────────────────────────────────────

/**
 * vmfix19 (Issue #26): spawn postgres via pg_ctl, which drops admin membership
 * via CreateRestrictedToken before launching postgres.exe. Returns synthetic
 * PidRecord with the real postgres pid (read from postmaster.pid). pg_ctl
 * itself is a short-lived helper that exits after postgres is ready, so
 * supervisor has no ChildProcess for the long-running postgres; instead we
 * register postgresStopHandler for gracefulShutdown to call pg_ctl stop.
 */
function spawnPgCtlPostgres(svc: ServiceDef, paths: DataPaths, env: SupervisorEnv): PidRecord {
  log.info(`[postgres] starting via pg_ctl (drops admin token before launching postgres)`);
  const r = spawnSync(svc.exe, svc.args, {
    encoding: 'utf8',
    env: subprocessEnv(env),
    windowsHide: true,
    timeout: 90_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const line of (r.stdout ?? '').split(/\r?\n/)) {
    if (line.trim()) log.info(`  [pg_ctl] ${line}`);
  }
  for (const line of (r.stderr ?? '').split(/\r?\n/)) {
    if (line.trim()) log.warn(`  [pg_ctl] ${line}`);
  }
  if (r.signal === 'SIGTERM') {
    throw new Error(`pg_ctl start timed out after 90s`);
  }
  if (r.status !== 0) {
    throw new Error(`pg_ctl start failed: status=${r.status}`);
  }

  // Read real postgres pid from postmaster.pid (line 1).
  const postmasterPidFile = path.join(paths.pgdataDir, 'postmaster.pid');
  let pid = 0;
  try {
    const head = readFileSync(postmasterPidFile, 'utf8').split(/\r?\n/)[0]?.trim() ?? '';
    pid = parseInt(head, 10);
  } catch (e) {
    throw new Error(`pg_ctl claimed success but could not read ${postmasterPidFile}: ${(e as Error).message}`);
  }
  if (!pid || isNaN(pid)) {
    throw new Error(`pg_ctl claimed success but postmaster.pid first line is not a valid pid`);
  }

  // Register the stop handler for gracefulShutdown.
  const pgCtlExe = svc.exe;
  const pgdataDir = paths.pgdataDir;
  const cleanEnv = subprocessEnv(env);
  postgresStopHandler = () => {
    try {
      log.info(`[shutdown] pg_ctl stop -m fast (pid=${pid})`);
      spawnSync(pgCtlExe, ['stop', '-D', pgdataDir, '-m', 'fast', '-w', '-t', '30'], {
        encoding: 'utf8',
        env: cleanEnv,
        windowsHide: true,
        timeout: 35_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      log.info(`[shutdown] postgres stopped`);
    } catch (e) {
      log.warn(`[shutdown] pg_ctl stop failed: ${(e as Error).message}`);
    }
  };

  log.info(`[postgres] spawned pid=${pid} (via pg_ctl) exe=${path.join(env.installPath, 'runtime', 'postgres', 'bin', 'postgres.exe')} (pid file deferred until ready)`);
  return {
    service: svc.name,
    pid,
    exe: path.join(env.installPath, 'runtime', 'postgres', 'bin', 'postgres.exe'),
    args: ['-D', paths.pgdataDir, '-p', String(env.pgPort)],
    installPath: env.installPath,
    startedAt: Date.now(),
    cwd: undefined,
  };
}

function spawnDetached(svc: ServiceDef, paths: DataPaths, env: SupervisorEnv): PidRecord {
  // vmfix19 (Issue #26): postgres takes the pg_ctl path.
  if (svc.pgCtl) {
    return spawnPgCtlPostgres(svc, paths, env);
  }

  const logFile = path.join(paths.logsDir, `${svc.name}.log`);
  const fdOut = openSync(logFile, 'a');
  const fdErr = openSync(logFile, 'a');

  // Issue #19 (vmfix12): supervisor runs as a Windows Service via WinSW.
  // SCM owns lifecycle; supervisor stays alive for service duration.
  // detached:false + windowsHide:true = hidden, tied to supervisor.
  // No console window EVER (services execute in session 0).
  const child = spawn(svc.exe, svc.args, {
    detached: false,
    stdio: ['ignore', fdOut, fdErr],
    cwd: svc.cwd ?? path.dirname(svc.exe),
    env: subprocessEnv(env),
    windowsHide: true,
  });

  if (!child.pid) throw new Error(`Failed to spawn ${svc.name}`);

  // Track for SIGTERM handler. Key by service name.
  activeChildren.set(svc.name, child);
  child.on('exit', (code, signal) => {
    log.info(`[${svc.name}] child exited code=${code} signal=${signal}`);
    activeChildren.delete(svc.name);
  });

  const rec: PidRecord = {
    service: svc.name,
    pid: child.pid,
    exe: svc.exe,
    args: svc.args,
    installPath: env.installPath,
    startedAt: Date.now(),
    cwd: svc.cwd,
  };
  // vmfix12 (Issue #18 audit finding): pid file written ONLY after readiness
  // probe passes. Caller commits pid via commitPidFile() below. We log the
  // spawn here so the trail is visible even on early failure.
  log.info(`[${svc.name}] spawned pid=${child.pid} exe=${svc.exe} (pid file deferred until ready)`);
  return rec;
}

/**
 * Commit the pid file only after readiness has been verified. Prevents the
 * Issue #18 symptom where pid files lingered for processes that died at start.
 */
function commitPidFile(svc: ServiceDef, rec: PidRecord, paths: DataPaths): void {
  writePidFile(paths.runDir, svc.name, rec);
  log.info(`[${svc.name}] pid file committed: ${path.join(paths.runDir, svc.name + '.pid')}`);
}

// ── bootstrap lock (vmfix6 §4) ─────────────────────────────────────────────
/**
 * Prevents two `Start TeleHubX` clicks from running concurrent supervisors,
 * which would race init-pgdata, race for ports, race for pid files.
 *
 * Lock file: <runDir>/supervisor.lock
 *   contents: { pid, startedAt, exe }
 *
 * Behavior:
 *   - If lock present AND pid alive AND startedAt within tolerance -> exit
 *     gracefully with "TeleHubX is already starting".
 *   - If lock present but stale (process gone) -> remove and continue.
 *   - On normal exit / fatal error / SIGINT / SIGTERM -> release lock.
 */
const LOCK_FILE_NAME = 'supervisor.lock';
const LOCK_STALE_TOLERANCE_MS = 5 * 60_000;
let acquiredLockPath: string | null = null;

function acquireBootstrapLock(runDir: string): { acquired: boolean; reason?: string } {
  const lockPath = path.join(runDir, LOCK_FILE_NAME);
  if (existsSync(lockPath)) {
    try {
      const meta = JSON.parse(readFileSync(lockPath, 'utf8'));
      const pid = Number(meta.pid);
      if (Number.isFinite(pid) && pid > 0 && isPidAlive(pid)) {
        const age = Date.now() - Number(meta.startedAt ?? 0);
        if (age < LOCK_STALE_TOLERANCE_MS) {
          return { acquired: false, reason: `another supervisor running (pid=${pid}, age=${Math.round(age/1000)}s)` };
        }
        log.warn(`bootstrap lock held by pid=${pid} but is ${Math.round(age/1000)}s old; treating as stale`);
      } else {
        log.warn(`bootstrap lock pid=${meta.pid} not alive; removing stale lock`);
      }
    } catch {
      log.warn(`bootstrap lock unreadable; removing`);
    }
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
  try {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), exe: process.execPath }, null, 2),
      'utf8',
    );
    acquiredLockPath = lockPath;
    return { acquired: true };
  } catch (e) {
    return { acquired: false, reason: `failed to write lock: ${(e as Error).message}` };
  }
}

function releaseBootstrapLock(): void {
  if (!acquiredLockPath) return;
  try { unlinkSync(acquiredLockPath); } catch { /* ignore */ }
  acquiredLockPath = null;
}

// vmfix12 / Issue #19: graceful shutdown hooks for service mode.
// WinSW sends Ctrl+Break (and Ctrl+C as fallback) when SCM stops the service.
// Node maps both to SIGINT/SIGTERM/SIGBREAK. We kill all spawned children
// in reverse order so dashboard/agent stop before server before redis before
// postgres (avoids client-disconnect noise).
function gracefulShutdown(signal: string): void {
  log.info(`==== supervisor received ${signal} — stopping children ====`);
  const reverseOrder = ['dashboard', 'agent', 'server', 'redis', 'postgres'];
  for (const name of reverseOrder) {
    // vmfix19 (Issue #26): postgres is detached (started via pg_ctl) and not
    // tracked in activeChildren. Use the registered pg_ctl stop handler
    // for a graceful shutdown that lets postgres clean up postmaster.pid
    // and avoids stale lock files on the next start.
    if (name === 'postgres' && postgresStopHandler) {
      try { postgresStopHandler(); }
      catch (e) { log.warn(`[shutdown] postgres handler failed: ${(e as Error).message}`); }
      continue;
    }
    const child = activeChildren.get(name);
    if (!child) continue;
    try {
      log.info(`[shutdown] killing ${name} pid=${child.pid}`);
      // SIGTERM-equivalent on Windows (Node maps to taskkill /F internally
      // when not using process group). We use kill() which translates.
      child.kill();
    } catch (e) {
      log.warn(`[shutdown] kill ${name} failed: ${(e as Error).message}`);
    }
  }
  releaseBootstrapLock();
  // Give children up to 25 seconds to exit, then force-exit (WinSW will
  // hard-kill us at 30 seconds anyway).
  const deadline = Date.now() + 25_000;
  const tick = setInterval(() => {
    if (activeChildren.size === 0 || Date.now() > deadline) {
      clearInterval(tick);
      log.info(`==== supervisor exit (children remaining=${activeChildren.size}) ====`);
      process.exit(0);
    }
  }, 500);
}

process.on('exit',    () => releaseBootstrapLock());
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGBREAK' as NodeJS.Signals, () => gracefulShutdown('SIGBREAK'));
process.on('uncaughtException', (e) => {
  log.error(`uncaught: ${e.stack ?? e}`);
  releaseBootstrapLock();
  process.exit(99);
});

// ── port-occupant adoption (vmfix11 / Issue #17) ───────────────────────────
/**
 * If a port is already listening, return the owning process info.
 * Used to detect e.g. init-pgdata's leftover temp postgres so we can adopt
 * it (write a pid file for it) instead of trying to spawn another postgres
 * that would fail with "port already in use".
 *
 * Returns null if port not listening or if PowerShell query fails.
 */
function getPortOwnerSync(port: number): { pid: number; exePath: string | null; cmdLine: string | null } | null {
  const r = ssync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$conn = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
    `if ($conn) { ` +
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue; ` +
    `if ($p) { [PSCustomObject]@{ pid = [int]$p.ProcessId; exePath = $p.ExecutablePath; cmdLine = $p.CommandLine } | ConvertTo-Json -Compress } }`,
  ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  if (r.status !== 0) return null;
  const text = (r.stdout ?? '').trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text);
    return { pid: Number(o.pid), exePath: o.exePath ?? null, cmdLine: o.cmdLine ?? null };
  } catch { return null; }
}

/**
 * Try to adopt an already-listening port if it belongs to a process under
 * our install dir. Returns true if adopted (caller should skip spawn).
 * Returns false if port is free OR foreign-owned (caller proceeds normally
 * or will fail at spawn).
 */
function tryAdoptListeningService(
  svc: ServiceDef,
  paths: DataPaths,
  env: SupervisorEnv,
  port: number,
): boolean {
  const owner = getPortOwnerSync(port);
  if (!owner) return false;
  const live = (owner.exePath ?? '').toLowerCase();
  const installLower = env.installPath.toLowerCase();
  if (live.startsWith(installLower) || live === svc.exe.toLowerCase()) {
    log.info(`[adopt] port ${port} already listening, owner pid=${owner.pid} (${owner.exePath}) — adopting as ${svc.name}`);
    const rec: PidRecord = {
      service: svc.name,
      pid: owner.pid,
      exe: owner.exePath ?? svc.exe,
      args: svc.args,
      installPath: env.installPath,
      startedAt: Date.now(),
      cwd: svc.cwd,
    };
    writePidFile(paths.runDir, svc.name, rec);
    return true;
  }
  log.warn(`[adopt] port ${port} occupied by FOREIGN process pid=${owner.pid} exe=${owner.exePath}; will not adopt; spawn will likely fail`);
  return false;
}

// ── stale pid cleanup + service-reuse detection (vmfix6 §5 / vmfix8 §5) ────
const STALE_SERVICE_NAMES = ['postgres', 'redis', 'server', 'agent', 'dashboard'];

/**
 * Returns a Set of service names that are already running and owned by this
 * TeleHubX install. Caller must skip spawning these.
 *
 * Side effects:
 *   - removes pid files for dead PIDs
 *   - removes pid files for alive PIDs that now belong to foreign processes
 *     (never kills them — broad-kill prohibited)
 *   - leaves pid files for alive+ours and reports as already-running
 */
function cleanStalePidFiles(runDir: string, installPath: string): Set<string> {
  const alreadyRunning = new Set<string>();
  if (!existsSync(runDir)) return alreadyRunning;
  for (const svc of STALE_SERVICE_NAMES) {
    const rec = readPidFile(runDir, svc);
    if (!rec) continue;
    if (!isPidAlive(rec.pid)) {
      log.info(`[stale-pid] ${svc} pid=${rec.pid} dead — removing pid file`);
      deletePidFile(runDir, svc);
      continue;
    }
    const info = getProcessInfo(rec.pid);
    if (!info) {
      log.warn(`[stale-pid] ${svc} pid=${rec.pid} alive but unqueryable; treating as not ours; removing pid file (will not kill)`);
      deletePidFile(runDir, svc);
      continue;
    }
    const live = (info.exePath ?? '').toLowerCase();
    const inInstall = live.startsWith(installPath.toLowerCase());
    const matchesRecorded = live === (rec.exe ?? '').toLowerCase();
    if (!inInstall && !matchesRecorded) {
      log.warn(`[stale-pid] ${svc} pid=${rec.pid} now belongs to foreign process (${info.exePath}); removing pid file but NOT killing`);
      deletePidFile(runDir, svc);
      continue;
    }
    log.info(`[reuse] ${svc} pid=${rec.pid} already running and ours — will skip spawn`);
    alreadyRunning.add(svc);
  }

  for (const f of readdirSync(runDir)) {
    if (f.endsWith('.pid')) {
      const name = f.slice(0, -4);
      if (!STALE_SERVICE_NAMES.includes(name)) {
        log.warn(`[stale-pid] unknown pid file ${f}; leaving in place for operator review`);
      }
    }
  }
  return alreadyRunning;
}

// ── server health timeout diagnostics (vmfix6 §6) ──────────────────────────
async function diagnoseServerHealthFailure(
  svc: ServiceDef,
  pidFile: string,
  paths: DataPaths,
  env: SupervisorEnv,
): Promise<void> {
  log.error('==== diagnostic dump (server health timed out) ====');
  const rec = readPidFile(paths.runDir, svc.name);
  let serverDead = false;
  if (rec) {
    const alive = isPidAlive(rec.pid);
    log.error(`pid=${rec.pid} alive=${alive}`);
    if (alive) {
      const info = getProcessInfo(rec.pid);
      log.error(`live exe: ${info?.exePath ?? '?'}`);
      log.error(`live cmd: ${(info?.cmdLine ?? '').slice(0, 200)}`);
    } else {
      serverDead = true;
    }
    log.error(`recorded cmd: ${svc.exe} ${svc.args.join(' ')}`);
    log.error(`cwd: ${svc.cwd ?? path.dirname(svc.exe)}`);
  } else {
    log.error('no pid file (spawn never recorded)');
  }
  log.error('env keys (values redacted): ' +
    ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','PG_HOST','PG_PORT',
     'REDIS_HOST','REDIS_PORT','APP_PORT','TELEHUBX_DATA_DIR','TELEHUBX_INSTALL_PATH',
     'JWT_SECRET','SESSION_ENCRYPTION_KEY','AGENT_TOKEN','LICENSE_SERVER_URL']
       .filter(k => process.env[k] !== undefined).join(','));
  log.error(`port ${env.appPort} listening: ${await tcpProbe('127.0.0.1', env.appPort, 500)}`);
  log.error(`port ${env.pgPort} listening:  ${await tcpProbe('127.0.0.1', env.pgPort, 500)}`);
  log.error(`port ${env.redisPort} listening:  ${await tcpProbe('127.0.0.1', env.redisPort, 500)}`);

  // Tail the relevant logs. server.log gets the synchronous milestone/fatal
  // lines from main.ts vmfix7 emit(); app-* and error-* are winston rotation files.
  for (const tail of [
    path.join(paths.logsDir, 'server.log'),
    path.join(paths.logsDir, `app-${new Date().toISOString().slice(0, 10)}.log`),
    path.join(paths.logsDir, `error-${new Date().toISOString().slice(0, 10)}.log`),
  ]) {
    if (!existsSync(tail)) { log.error(`(no ${path.basename(tail)})`); continue; }
    try {
      const lines = readFileSync(tail, 'utf8').split(/\r?\n/);
      const lastN = lines.slice(Math.max(0, lines.length - 80));
      log.error(`---- ${path.basename(tail)} (last ${lastN.length} lines) ----`);
      for (const l of lastN) if (l.trim()) log.error(`  ${l}`);
      // Highlight any FATAL lines so they're easy to spot in supervisor.log
      const fatals = lines.filter(l => /\[FATAL\]/.test(l));
      if (fatals.length) {
        log.error(`---- ${path.basename(tail)} FATAL lines (${fatals.length}) ----`);
        for (const f of fatals.slice(-10)) log.error(`  ${f}`);
      }
    } catch { /* ignore */ }
  }
  // vmfix10 (Issue #16): if server is confirmed dead, remove its stale pid
  // file immediately so the next Start doesn't see a "ghost" pid file
  // and skip spawn under reuse logic.
  if (serverDead) {
    log.error(`server pid was confirmed dead — removing stale ${svc.name}.pid`);
    deletePidFile(paths.runDir, svc.name);
  }
  log.error('==== end diagnostic dump ====');
}

// ── license probe ──────────────────────────────────────────────────────────
async function getLicenseStatus(env: SupervisorEnv): Promise<string> {
  return new Promise(resolve => {
    const req = http.get(
      `http://127.0.0.1:${env.appPort}/cloud-license/status`,
      { timeout: 5000 },
      res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => {
          try {
            const o = JSON.parse(body) as { effectiveStatus?: string };
            resolve(o?.effectiveStatus ?? 'unknown');
          } catch { resolve('unknown'); }
        });
      },
    );
    req.on('error', () => resolve('unknown'));
    req.on('timeout', () => { req.destroy(); resolve('unknown'); });
  });
}

function openBrowser(url: string): void {
  // vmfix8: rundll32 url.dll,FileProtocolHandler launches the URL via shell
  // association without flashing a cmd console window. cmd /c start "" url
  // briefly shows a console even with windowsHide.
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  log.info(`opened browser: ${url}`);
}

// ── init-pgdata invocation (vmfix6 §3) ─────────────────────────────────────
function runInitPgdata(env: SupervisorEnv): void {
  const initScript = path.join(env.installPath, 'runtime', 'postgres', 'init-pgdata.cjs');
  if (!existsSync(initScript)) {
    log.warn(`init-pgdata script missing at ${initScript} — assuming pgdata ready`);
    return;
  }
  log.info('[postgres] running init-pgdata (truly idempotent — verifies db + extension + connectivity)');
  const portableNode = path.join(env.installPath, 'runtime', 'node', 'node.exe');
  const seaMode = path.basename(process.execPath).toLowerCase().startsWith('telehubx-');
  const nodeBin = existsSync(portableNode) ? portableNode
                 : seaMode ? '' : process.execPath;
  if (!nodeBin) {
    log.error(`init-pgdata: portable node missing at ${portableNode} (required when running as SEA exe)`);
    process.exit(5);
  }
  const r = spawnSync(nodeBin, [initScript], {
    encoding: 'utf8',
    env: subprocessEnv(env),
    windowsHide: true,
    timeout: 240_000,                           // 4 min, init-pgdata's own steps each have <2 min sub-timeouts
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const line of (r.stdout ?? '').split(/\r?\n/)) {
    if (line.trim()) log.info(`  ${line}`);
  }
  for (const line of (r.stderr ?? '').split(/\r?\n/)) {
    if (line.trim()) log.warn(`  ${line}`);
  }
  if (r.signal === 'SIGTERM') {
    log.error(`init-pgdata timed out after 240s (signal=${r.signal})`);
    process.exit(5);
  }
  if (r.status !== 0) {
    log.error(`init-pgdata failed (status=${r.status})`);
    process.exit(5);
  }
  log.info('[postgres] init-pgdata completed');
}

// ── main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const env = loadSupervisorEnv();
  const paths = buildDataPaths(env.dataDir);
  setLogFile(path.join(paths.logsDir, 'supervisor.log'));

  log.info('==== TeleHubX supervisor starting ====');
  log.info(`installPath=${env.installPath}`);
  log.info(`dataDir=${paths.root}`);
  log.info(`runtimeMode=${env.runtimeMode}`);
  log.info(`ports: app=${env.appPort} dashboard=${env.dashboardPort} pg=${env.pgPort} redis=${env.redisPort}`);

  // vmfix19 (Issue #26): log effective token groups so future regressions
  // around the postgres "admin permissions" check are diagnosable from logs
  // alone. Filtered to security-relevant groups (Administrators / SERVICE /
  // SYSTEM / LOCAL SERVICE). Failure here is non-fatal.
  try {
    const groups = ssync('whoami', ['/groups', '/fo', 'list'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).stdout ?? '';
    const interesting = groups
      .split(/\r?\n/)
      .filter(l => /Administrators|LOCAL SERVICE|NT AUTHORITY\\SERVICE|NT AUTHORITY\\SYSTEM|Mandatory Label/i.test(l))
      .map(l => l.trim())
      .filter(Boolean);
    log.info(`[token] effective groups (filtered): ${interesting.length ? interesting.join(' | ') : '<none matched>'}`);
  } catch (e) {
    log.warn(`[token] could not query whoami /groups: ${(e as Error).message}`);
  }

  // probe mode bypasses lock + pid cleanup (read-only)
  if (env.runtimeMode === 'probe') {
    const services = buildServices(env, paths);
    log.info('probe mode: skipping all spawn, will check existing services');
    for (const svc of services) {
      const ok = await svc.health();
      log.info(`[${svc.name}] reachable=${ok}`);
    }
    const status = await getLicenseStatus(env);
    log.info(`license effectiveStatus=${status}`);
    const url = (status === 'unconfigured' || status === 'locked')
      ? `http://127.0.0.1:${env.dashboardPort}/settings/license`
      : `http://127.0.0.1:${env.dashboardPort}/`;
    if (process.env.TELEHUBX_PROBE_NO_BROWSER !== '1') openBrowser(url);
    log.info('probe done');
    return;
  }

  // Acquire bootstrap lock (vmfix6 §4)
  const lock = acquireBootstrapLock(paths.runDir);
  if (!lock.acquired) {
    log.warn(`TeleHubX is already starting — ${lock.reason}`);
    log.warn('exiting gracefully (this is normal if user double-clicked Start)');
    process.exit(0);
  }

  // Stale pid cleanup + already-running detection (vmfix6 §5 + vmfix8 §5)
  const alreadyRunning = cleanStalePidFiles(paths.runDir, env.installPath);

  const services = buildServices(env, paths);

  // dev mode: PG/Redis assumed external
  if (env.runtimeMode === 'dev') {
    log.info('dev mode: PG/Redis assumed external (Docker)');
    if (!await tcpProbe('127.0.0.1', env.pgPort)) {
      log.warn(`Postgres @${env.pgPort} not reachable — server may fail`);
    }
    if (!await tcpProbe('127.0.0.1', env.redisPort)) {
      log.warn(`Redis @${env.redisPort} not reachable — queues will fail`);
    }
  }

  // sequential startup
  for (const svc of services) {
    if (!svc.enabledIn.includes(env.runtimeMode as 'dev' | 'prod')) {
      log.info(`[${svc.name}] skipped (mode=${env.runtimeMode})`);
      continue;
    }
    if (!existsSync(svc.exe)) {
      log.error(`[${svc.name}] exe missing: ${svc.exe}`);
      if (svc.critical) {
        log.error(`aborting: critical service exe missing`);
        process.exit(2);
      }
      continue;
    }

    if (svc.name === 'postgres') {
      if (!alreadyRunning.has('postgres')) {
        runInitPgdata(env);
      } else {
        log.info('[postgres] reuse — skipping init-pgdata');
      }
    }

    if (alreadyRunning.has(svc.name)) {
      log.info(`[${svc.name}] reusing already-running instance, no spawn`);
    } else {
      // vmfix11 (Issue #17): if init-pgdata's temp postgres didn't fully stop,
      // port may still be listening. Same for redis if a stale instance
      // survived. Try to adopt the existing process before spawning, which
      // would otherwise fail with port-in-use.
      let adopted = false;
      if (svc.name === 'postgres' && await tcpProbe('127.0.0.1', env.pgPort, 500)) {
        adopted = tryAdoptListeningService(svc, paths, env, env.pgPort);
      } else if (svc.name === 'redis' && await tcpProbe('127.0.0.1', env.redisPort, 500)) {
        adopted = tryAdoptListeningService(svc, paths, env, env.redisPort);
      }
      if (!adopted) {
        let rec: PidRecord | null = null;
        try { rec = spawnDetached(svc, paths, env); }
        catch (e) {
          log.error(`[${svc.name}] spawn failed: ${(e as Error).message}`);
          // vmfix12 (Issue #19): in service mode, do NOT process.exit(N) —
          // SCM treats supervisor exit as service crash and triggers restart
          // loop per onfailure policy. Better to log and continue: the
          // service ends up "Running but unhealthy" which Bryan can debug
          // via the Debug shortcut without endless SCM restarts.
          if (svc.critical) {
            log.error(`critical service ${svc.name} could not spawn — supervisor staying alive for diagnostics`);
          }
          continue;
        }

        // Wait for readiness BEFORE committing pid file.
        const ready = await waitFor(svc.health, svc.name, svc.healthTimeoutMs, 1000);
        if (!ready) {
          log.warn(`[${svc.name}] health probe timed out after ${svc.healthTimeoutMs}ms`);
          if (svc.name === 'server') {
            await diagnoseServerHealthFailure(svc, path.join(paths.runDir, 'server.pid'), paths, env);
          }
          if (svc.critical) {
            log.error(`[${svc.name}] critical service unhealthy — leaving pid uncommitted; supervisor stays alive for diagnostics (Debug shortcut)`);
          }
          // Do not commit pid file for an unhealthy service.
          continue;
        }
        // Healthy — commit pid file now. (Issue #18 fix: no premature pid commit.)
        commitPidFile(svc, rec, paths);
      } else {
        // Adopted services already have a pid file written by tryAdoptListeningService.
        const ready = await waitFor(svc.health, svc.name, svc.healthTimeoutMs, 1000);
        if (!ready) {
          log.warn(`[${svc.name}] adopted instance failed health probe`);
        }
      }
    }
  }

  // license-driven URL choice
  let url = `http://127.0.0.1:${env.dashboardPort}/`;
  try {
    const status = await getLicenseStatus(env);
    log.info(`license effectiveStatus=${status}`);
    if (status === 'unconfigured' || status === 'locked') {
      url = `http://127.0.0.1:${env.dashboardPort}/settings/license`;
    }
  } catch (e) {
    log.warn(`license status check failed: ${(e as Error).message}`);
  }

  openBrowser(url);

  // vmfix11 (Issues #15+#17): supervisor now STAYS ALIVE for the lifetime of
  // its children. Without this, detached:false children get terminated when
  // supervisor exits (Windows behavior). This was the root cause of #17:
  // pid files appeared briefly then disappeared because supervisor exited
  // shortly after spawning, taking redis/server/agent/dashboard with it.
  //
  // Since we did NOT call child.unref() in spawnDetached, the event loop is
  // already kept alive by the children's process handles. We just don't
  // call process.exit().
  //
  // Final status line for ops:
  log.info('==== supervisor STARTUP COMPLETE — staying alive to keep services hidden + supervised ====');
  log.info(`pid files: ${readdirSync(paths.runDir).filter(f => f.endsWith('.pid')).join(', ')}`);

  // Heartbeat every 5 minutes confirms supervisor is still alive without
  // log spam. Stop tool / OS shutdown / SIGTERM handles cleanup.
  setInterval(() => {
    log.info('[heartbeat] supervisor alive, services running');
  }, 5 * 60_000);
  // Lock released by 'exit' handler when supervisor finally exits.
}

main().catch(e => {
  log.error(`supervisor fatal: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
