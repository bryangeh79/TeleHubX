import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Minimal .env parser (avoids dotenv dependency for Node SEA size).
 * Supports: KEY=value / KEY="value" / # comments / blank lines.
 * Does NOT support: multi-line values, ${...} substitution.
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
  /** Install dir: prod = %ProgramFiles%\TeleHubX; dev = repo root */
  installPath: string;
  /** Data dir (user-writable): prod = %APPDATA%\TeleHubX\data; dev = <installPath>\data */
  dataDir: string;
  /**
   * dev   : assume external PG/Redis (Docker), supervisor only spawns server/agent/dashboard
   * prod  : supervisor spawns all 5 processes incl. portable postgres + bundled redis
   * probe : no spawn, only port reachability + license probe + open browser (CI/test mode)
   */
  runtimeMode: RuntimeMode;
  appPort: number;
  dashboardPort: number;
  pgPort: number;
  redisPort: number;
  licenseServerUrl: string;
}

/** True when running inside the Inno-Setup-installed SEA exe (telehubx-*.exe). */
function isSeaExe(): boolean {
  return path.basename(process.execPath).toLowerCase().startsWith('telehubx-');
}

function detectInstallPath(): string {
  // 1. Explicit env var wins
  if (process.env.TELEHUBX_INSTALL_PATH) return path.resolve(process.env.TELEHUBX_INSTALL_PATH);

  // 2. SEA exe: process.execPath is {app}\tools\telehubx-{supervisor,stop}.exe -> installPath = {app}
  if (isSeaExe()) {
    return path.resolve(path.dirname(process.execPath), '..');
  }

  // 3. Plain node running dist/supervisor.js or dist-bundle/supervisor.cjs:
  //    walk up from __dirname until we find apps/server/dist/main.js (repo root)
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'apps', 'server', 'dist', 'main.js'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 4. Phase 2 compatibility fallback
  return path.resolve(__dirname, '..', '..', '..', '..');
}

/**
 * Default dataDir resolution:
 *   - Explicit TELEHUBX_DATA_DIR (after .env load) wins
 *   - SEA exe (installed mode): %APPDATA%\TeleHubX\data (user-writable)
 *   - Otherwise (dev): <installPath>/data (repo-local)
 *
 * IMPORTANT: We do NOT default to <installPath>/data when running as SEA,
 * because installPath is %ProgramFiles%\TeleHubX which is read-only for the
 * unprivileged user that double-clicked the desktop shortcut. Writing logs
 * there fails with EPERM (Issue #14).
 */
function defaultDataDir(installPath: string): string {
  if (isSeaExe() && process.env.APPDATA) {
    return path.resolve(process.env.APPDATA, 'TeleHubX', 'data');
  }
  return path.resolve(installPath, 'data');
}

/**
 * Default runtimeMode resolution:
 *   - Explicit TELEHUBX_RUNTIME_MODE (after .env load) wins
 *   - SEA exe + portable postgres binary present  -> 'prod' (production install)
 *   - SEA exe without portable postgres           -> 'prod' anyway (will fail loud, not silently degrade to dev which would be wrong on a customer machine that has no Docker)
 *   - Plain node (dev workspace)                  -> 'dev'
 */
function defaultRuntimeMode(installPath: string): RuntimeMode {
  if (isSeaExe()) return 'prod';
  // Heuristic for non-SEA: portable runtime present means we're inside an unpacked installer
  if (existsSync(path.join(installPath, 'runtime', 'postgres', 'bin', 'postgres.exe'))) {
    return 'prod';
  }
  return 'dev';
}

/**
 * Bootstrap %APPDATA%\TeleHubX\.env from <installPath>\.env.template on first run.
 * Runs in the user's security context (supervisor.exe is launched by the user
 * via the desktop shortcut), so it always lands in the *running user*'s AppData
 * — even if the install was performed as a different admin account.
 *
 * No-op if target already exists (preserves user-edited config).
 */
function bootstrapUserEnv(installPath: string): string | null {
  const appdata = process.env.APPDATA;
  if (!appdata || !isSeaExe()) return null;
  const userEnvDir  = path.join(appdata, 'TeleHubX');
  const userEnvFile = path.join(userEnvDir, '.env');
  if (existsSync(userEnvFile)) return userEnvFile;
  const tpl = path.join(installPath, '.env.template');
  if (!existsSync(tpl)) return null;
  try {
    mkdirSync(userEnvDir, { recursive: true });
    copyFileSync(tpl, userEnvFile);
    return userEnvFile;
  } catch {
    return null;
  }
}

export function loadSupervisorEnv(): SupervisorEnv {
  const installPath = detectInstallPath();

  // First-run bootstrap (creates %APPDATA%\TeleHubX\.env from .env.template if missing)
  bootstrapUserEnv(installPath);

  // Build .env candidate list. Order = highest priority first; later candidates
  // do NOT overwrite values already set by earlier candidates or process.env.
  const userEnv = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'TeleHubX', '.env')
    : null;
  const dataDirHint = expandWinVars(
    process.env.TELEHUBX_DATA_DIR ?? defaultDataDir(installPath),
  );
  const envCandidates: string[] = [
    ...(userEnv ? [userEnv] : []),                       // %APPDATA%\TeleHubX\.env  (production primary)
    path.join(dataDirHint, '..', '.env'),                // <dataDir>\..\.env
    path.join(installPath, '.env'),                      // <installPath>\.env
    path.join(installPath, '.env.template'),             // <installPath>\.env.template (Inno Setup ships this)
    path.join(installPath, 'installer', '.env.template'),// dev workspace fallback
  ];
  for (const f of envCandidates) {
    const parsed = parseEnvFile(f);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }

  // Resolve final dataDir: env var (which may have come from .env above) > default
  const dataDir = path.resolve(
    expandWinVars(process.env.TELEHUBX_DATA_DIR ?? defaultDataDir(installPath)),
  );

  // Resolve final runtimeMode: env var > default
  const explicitMode = (process.env.TELEHUBX_RUNTIME_MODE ?? '').toLowerCase();
  const runtimeMode: RuntimeMode =
    explicitMode === 'prod'  ? 'prod' :
    explicitMode === 'dev'   ? 'dev'  :
    explicitMode === 'probe' ? 'probe' :
    defaultRuntimeMode(installPath);

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
