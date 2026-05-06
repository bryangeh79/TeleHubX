import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { loadSupervisorEnv, type SupervisorEnv } from './shared/env';
import { buildDataPaths, type DataPaths } from './shared/paths';
import { log, setLogFile } from './shared/log';
import { writePidFile, type PidRecord } from './shared/pid-store';

/**
 * TeleHubX supervisor — 启动器
 *
 * 模式:
 *   prod  : 启动 postgres + memurai + server + agent + dashboard 5 进程
 *   dev   : 假设 PG/Redis 由 Docker 提供, 仅启动 server + agent + dashboard
 *   probe : 仅探测端口 + 查 license + 开浏览器, 不 spawn 任何进程（无侵入测试）
 *
 * 启动后写 PID 元数据到 <dataDir>/run/<service>.pid，
 * 自身 spawn detached + unref 后退出，子进程继续后台运行。
 */

interface ServiceDef {
  name: 'postgres' | 'memurai' | 'server' | 'agent' | 'dashboard';
  exe: string;
  args: string[];
  cwd?: string;
  enabledIn: ('dev' | 'prod')[];
  health: () => Promise<boolean>;
  /** 健康探测超时（毫秒） */
  healthTimeoutMs: number;
  /** server 失败时整体 abort；其他 service 失败仅警告 */
  critical: boolean;
}

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
      name: 'memurai',
      exe: path.join(env.installPath, 'runtime', 'memurai', 'memurai.exe'),
      args: ['--port', String(env.redisPort), '--dir', paths.memuraiDir],
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
      health: () => httpProbe(`http://127.0.0.1:${env.appPort}/health`),
      healthTimeoutMs: 45000,
      critical: true,
    },
    {
      name: 'agent',
      exe: node,
      args: [path.join(env.installPath, 'apps', 'agent', 'dist', 'main.js')],
      cwd: path.join(env.installPath, 'apps', 'agent'),
      enabledIn: ['dev', 'prod'],
      // agent 没有 HTTP 健康端点，仅检查进程存活（进程 spawn 即视为成功）
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

function spawnDetached(svc: ServiceDef, paths: DataPaths, env: SupervisorEnv): PidRecord {
  const logFile = path.join(paths.logsDir, `${svc.name}.log`);
  const fdOut = openSync(logFile, 'a');
  const fdErr = openSync(logFile, 'a');

  const child = spawn(svc.exe, svc.args, {
    detached: true,
    stdio: ['ignore', fdOut, fdErr],
    cwd: svc.cwd ?? path.dirname(svc.exe),
    env: process.env,
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
  // Windows: start "" "<url>"; 用 cmd /c 启动避免 PowerShell 引号问题
  spawn('cmd', ['/c', 'start', '""', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  log.info(`opened browser: ${url}`);
}

async function main(): Promise<void> {
  const env = loadSupervisorEnv();
  const paths = buildDataPaths(env.dataDir);
  setLogFile(path.join(paths.logsDir, 'supervisor.log'));

  log.info('==== TeleHubX supervisor starting ====');
  log.info(`installPath=${env.installPath}`);
  log.info(`dataDir=${paths.root}`);
  log.info(`runtimeMode=${env.runtimeMode}`);
  log.info(`ports: app=${env.appPort} dashboard=${env.dashboardPort} pg=${env.pgPort} redis=${env.redisPort}`);

  const services = buildServices(env, paths);

  // probe 模式: 不 spawn, 仅探测 + 开浏览器
  if (env.runtimeMode === 'probe') {
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

  // dev 模式: 验证外部 PG/Redis 可达
  if (env.runtimeMode === 'dev') {
    log.info(`dev mode: PG/Redis assumed external (Docker)`);
    if (!await tcpProbe('127.0.0.1', env.pgPort)) {
      log.warn(`Postgres @${env.pgPort} not reachable — server may fail`);
    }
    if (!await tcpProbe('127.0.0.1', env.redisPort)) {
      log.warn(`Redis @${env.redisPort} not reachable — queues will fail`);
    }
  }

  // 顺序启动
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

    // postgres 首次启动先调 init-pgdata 脚本（idempotent）
    if (svc.name === 'postgres') {
      const initScript = path.join(env.installPath, 'runtime', 'postgres', 'init-pgdata.cjs');
      if (existsSync(initScript)) {
        log.info(`[postgres] running init-pgdata (idempotent)`);
        const portableNode = path.join(env.installPath, 'runtime', 'node', 'node.exe');
        const nodeBin = existsSync(portableNode) ? portableNode : process.execPath;
        const r = require('node:child_process').spawnSync(nodeBin, [initScript], {
          encoding: 'utf8',
          env: process.env,
          windowsHide: true,
        });
        if (r.status !== 0) {
          log.error(`init-pgdata failed (status=${r.status}): ${(r.stderr ?? '').slice(0, 500)}`);
          process.exit(5);
        }
      } else {
        log.warn(`init-pgdata script missing at ${initScript} — assuming pgdata already initialized`);
      }
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
      if (svc.critical) {
        log.error(`aborting: critical service ${svc.name} not healthy`);
        process.exit(4);
      }
    }
  }

  // license 状态决定打开 URL
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
  process.exit(0);
}

main().catch(e => {
  log.error(`supervisor fatal: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
