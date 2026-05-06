import { mkdirSync } from 'node:fs';
import * as path from 'node:path';

/**
 * 与 apps/server/src/common/paths.ts 同源（独立副本，避免 supervisor 依赖 server 编译产物）。
 */

export interface DataPaths {
  root: string;
  pgdataDir: string;
  redisDataDir: string;
  licenseFile: string;
  machineFingerprintFile: string;
  agentTokenFile: string;
  sessionsDir: string;
  uploadsDir: string;
  logsDir: string;
  runDir: string;
}

export function buildDataPaths(dataDir: string): DataPaths {
  const root = path.resolve(dataDir);
  const out: DataPaths = {
    root,
    pgdataDir: path.join(root, 'pgdata'),
    redisDataDir: path.join(root, 'redis-data'),
    licenseFile: path.join(root, 'cloud-license.bin'),
    machineFingerprintFile: path.join(root, 'machine-fingerprint.txt'),
    agentTokenFile: path.join(root, 'agent-token.bin'),
    sessionsDir: path.join(root, 'sessions'),
    uploadsDir: path.join(root, 'uploads'),
    logsDir: path.join(root, 'logs'),
    runDir: path.join(root, 'run'),
  };
  for (const d of [
    out.root, out.pgdataDir, out.redisDataDir,
    out.sessionsDir, out.uploadsDir, out.logsDir, out.runDir,
  ]) {
    try { mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  }
  return out;
}
