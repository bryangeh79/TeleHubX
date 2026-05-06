import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * 极简 .env parser — 避免 dotenv 依赖（Node SEA 要求最小依赖）。
 * 支持: KEY=value / KEY="value" / 注释行 / 空行
 * 不支持: 多行值, 变量替换 (${...})
 */
export function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function expandWinVars(s: string): string {
  return s.replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? '');
}

export type RuntimeMode = 'dev' | 'prod' | 'probe';

export interface SupervisorEnv {
  /** 安装目录: prod = Program Files\TeleHubX; dev = repo root */
  installPath: string;
  /** 数据目录: prod = %APPDATA%\TeleHubX\data; dev = <installPath>\data */
  dataDir: string;
  /** dev: 假设 PG/Redis 由 Docker 提供，supervisor 仅启动 server/agent/dashboard */
  /** prod: supervisor 启动全部 5 个进程 */
  /** probe: 仅探测端口/license 状态 + 开浏览器, 不 spawn 任何进程 (用于本地无侵入测试) */
  runtimeMode: RuntimeMode;
  appPort: number;
  dashboardPort: number;
  pgPort: number;
  redisPort: number;
  licenseServerUrl: string;
}

/**
 * 解析顺序:
 *   1. process.env（运行时已设置的环境变量）
 *   2. <dataDir>/.env（用户编辑过的运行时配置）
 *   3. <installPath>/.env（安装时复制的 .env.template）
 *   4. <installPath>/installer/.env.template（dev fallback）
 */
export function loadSupervisorEnv(): SupervisorEnv {
  // installPath: 默认从可执行文件位置往上推算
  // dist/supervisor.js 在 installer/tools/dist/, 推 4 级到 repo root
  const installPath = path.resolve(
    process.env.TELEHUBX_INSTALL_PATH ?? path.resolve(__dirname, '..', '..', '..', '..'),
  );

  // 候选 .env 路径，按优先级
  const dataDirHint = expandWinVars(
    process.env.TELEHUBX_DATA_DIR ?? path.join(installPath, 'data'),
  );

  const envCandidates = [
    path.join(dataDirHint, '..', '.env'),
    path.join(installPath, '.env'),
    path.join(installPath, 'installer', '.env.template'),
  ];
  for (const f of envCandidates) {
    const parsed = parseEnvFile(f);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }

  const dataDir = path.resolve(
    expandWinVars(process.env.TELEHUBX_DATA_DIR ?? path.join(installPath, 'data')),
  );

  const mode = (process.env.TELEHUBX_RUNTIME_MODE ?? 'dev').toLowerCase();
  const runtimeMode: RuntimeMode =
    mode === 'prod' ? 'prod' :
    mode === 'probe' ? 'probe' : 'dev';

  return {
    installPath,
    dataDir,
    runtimeMode,
    appPort: Number(process.env.APP_PORT ?? 9800),
    dashboardPort: Number(process.env.DASHBOARD_PORT ?? 9601),
    pgPort: Number(process.env.PG_PORT ?? process.env.DB_PORT ?? 5436),
    redisPort: Number(process.env.REDIS_PORT ?? 6386),
    licenseServerUrl:
      process.env.LICENSE_SERVER_URL ?? 'https://telehubx-license.starbright-solutions.com',
  };
}
