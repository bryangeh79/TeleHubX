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
      exe: path.join(env.installPath, 'runtime', 'postgres', 'bin', 'postgres.exe'),
      args: ['-D', paths.pgdataDir, '-p', String(env.pgPort)],
      enabledIn: ['prod'],
      health: () => tcpProbe('127.0.0.1', env.pgPort),
      healthTimeoutMs: 30000,
      critical: true,
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
    // Server also auto-defaults this if missing; we set it here as belt-and-suspenders.
    CORS_ORIGINS: process.env.CORS_ORIGINS
      ?? `http://127.0.0.1:${env.dashboardPort},http://localhost:${env.dashboardPort}`,
  };
}

/** Try /health first (no global prefix), fall back to /api/v1/health. */
async function serverHealthProbe(appPort: number): Promise<boolean> {
  if (await httpProbe(`http://127.0.0.1:${appPort}/health`)) return true;
  return httpProbe(`http://127.0.0.1:${appPort}/api/v1/health`);
}

// ── spawn helpers ──────────────────────────────────────────────────────────
function spawnDetached(svc: ServiceDef, paths: DataPaths, env: SupervisorEnv): PidRecord {
  const logFile = path.join(paths.logsDir, `${svc.name}.log`);
  const fdOut = openSync(logFile, 'a');
  const fdErr = openSync(logFile, 'a');

  const child = spawn(svc.exe, svc.args, {
    detached: true,
    stdio: ['ignore', fdOut, fdErr],
    cwd: svc.cwd ?? path.dirname(svc.exe),
    env: subprocessEnv(env),
    windowsHide: true,
  });
  child.unref();

  if (!child.pid) throw new Error(`Failed to spawn ${svc.name}`);

  const rec: PidRecord = {
    service: svc.name,
    pid: child.pid,
    exe: svc.exe,
    args: svc.args,
    installPath: env.installPath,
    startedAt: Date.now(),
    cwd: svc.cwd,
  };
  writePidFile(paths.runDir, svc.name, rec);
  log.info(`[${svc.name}] spawned pid=${child.pid} exe=${svc.exe}`);
  return rec;
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

// Ensure lock is released on any abnormal exit
process.on('exit',    () => releaseBootstrapLock());
process.on('SIGINT',  () => { releaseBootstrapLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseBootstrapLock(); process.exit(143); });
process.on('uncaughtException', (e) => {
  log.error(`uncaught: ${e.stack ?? e}`);
  releaseBootstrapLock();
  process.exit(99);
});

// ── stale pid cleanup (vmfix6 §5) ──────────────────────────────────────────
const STALE_SERVICE_NAMES = ['postgres', 'redis', 'server', 'agent', 'dashboard'];

function cleanStalePidFiles(runDir: string, installPath: string): void {
  if (!existsSync(runDir)) return;
  for (const svc of STALE_SERVICE_NAMES) {
    const rec = readPidFile(runDir, svc);
    if (!rec) continue;
    if (!isPidAlive(rec.pid)) {
      log.info(`[stale-pid] ${svc} pid=${rec.pid} dead — removing pid file`);
      deletePidFile(runDir, svc);
      continue;
    }
    // PID alive — verify it's still ours (not a recycled foreign process)
    const info = getProcessInfo(rec.pid);
    if (!info) {
      log.warn(`[stale-pid] ${svc} pid=${rec.pid} alive but unqueryable; leaving pid file (will not kill)`);
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
    log.info(`[stale-pid] ${svc} pid=${rec.pid} still ours and alive — already running`);
  }

  // Sweep any unknown .pid files leftover from older builds
  for (const f of readdirSync(runDir)) {
    if (f.endsWith('.pid')) {
      const name = f.slice(0, -4);
      if (!STALE_SERVICE_NAMES.includes(name)) {
        log.warn(`[stale-pid] unknown pid file ${f}; leaving in place for operator review`);
      }
    }
  }
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
  if (rec) {
    const alive = isPidAlive(rec.pid);
    log.error(`pid=${rec.pid} alive=${alive}`);
    if (alive) {
      const info = getProcessInfo(rec.pid);
      log.error(`live exe: ${info?.exePath ?? '?'}`);
      log.error(`live cmd: ${(info?.cmdLine ?? '').slice(0, 200)}`);
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
  spawn('cmd', ['/c', 'start', '""', url], {
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

  // Stale pid cleanup (vmfix6 §5)
  cleanStalePidFiles(paths.runDir, env.installPath);

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
      runInitPgdata(env);
    }

    try { spawnDetached(svc, paths, env); }
    catch (e) {
      log.error(`[${svc.name}] spawn failed: ${(e as Error).message}`);
      if (svc.critical) process.exit(3);
      continue;
    }

    const ready = await waitFor(svc.health, svc.name, svc.healthTimeoutMs, 1000);
    if (!ready) {
      log.warn(`[${svc.name}] health probe timed out after ${svc.healthTimeoutMs}ms`);
      if (svc.name === 'server') {
        await diagnoseServerHealthFailure(svc, path.join(paths.runDir, 'server.pid'), paths, env);
      }
      if (svc.critical) {
        log.error(`aborting: critical service ${svc.name} not healthy`);
        process.exit(4);
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
  log.info('==== supervisor done — services running detached ====');
  // Lock released by 'exit' handler.
}

main().catch(e => {
  log.error(`supervisor fatal: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
