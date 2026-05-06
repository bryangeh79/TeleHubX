import { writeFileSync, readFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

export interface PidRecord {
  service: string;
  pid: number;
  exe: string;
  args: string[];
  installPath: string;
  /** Unix epoch ms */
  startedAt: number;
  cwd?: string;
}

export function writePidFile(runDir: string, service: string, rec: PidRecord): void {
  const file = path.join(runDir, `${service}.pid`);
  writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
}

export function readPidFile(runDir: string, service: string): PidRecord | null {
  const file = path.join(runDir, `${service}.pid`);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) as PidRecord; }
  catch { return null; }
}

export function deletePidFile(runDir: string, service: string): void {
  const file = path.join(runDir, `${service}.pid`);
  if (existsSync(file)) {
    try { unlinkSync(file); } catch { /* ignore */ }
  }
}

export function listPidFiles(runDir: string): string[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir).filter(f => f.endsWith('.pid')).map(f => f.slice(0, -4));
}
