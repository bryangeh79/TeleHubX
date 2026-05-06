import winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';

// Resolve user-writable log dir (Issue #14 vmfix3).
// Priority: LOG_DIR > TELEHUBX_DATA_DIR/logs > ./logs (dev fallback).
function resolveLogDir(): string {
  const expand = (s: string) => s.replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? '');
  const explicit = process.env.LOG_DIR;
  if (explicit && explicit.trim()) {
    const dir = path.resolve(expand(explicit));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dataDir = process.env.TELEHUBX_DATA_DIR;
  if (dataDir && dataDir.trim()) {
    const dir = path.join(path.resolve(expand(dataDir)), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.resolve(process.cwd(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const LOG_DIR = resolveLogDir();

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${String(timestamp)} ${level}: ${String(message)}${metaStr}`;
        }),
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'agent.log'),
      maxsize: 10_485_760,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10_485_760,
      maxFiles: 3,
    }),
  ],
});
