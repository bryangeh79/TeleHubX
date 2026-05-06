import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

/**
 * Resolve a user-writable log directory.
 *
 * Priority:
 *   1. LOG_DIR env (explicit override)
 *   2. TELEHUBX_DATA_DIR env / logs   (set by installer supervisor — production)
 *   3. ./logs relative to cwd          (dev workspace fallback)
 *
 * Issue #14 vmfix3: the previous default of relative 'logs/...' resolved
 * against cwd = <installPath>/apps/server when launched by supervisor on
 * Windows, which is under %ProgramFiles% and read-only -> EPERM mkdir.
 *
 * Expands %APPDATA% etc. for installer .env compatibility.
 */
function resolveLogDir(): string {
  const expandWinVars = (s: string) =>
    s.replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? '');

  const explicit = process.env.LOG_DIR;
  if (explicit && explicit.trim()) {
    const dir = path.resolve(expandWinVars(explicit));
    try { mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
    return dir;
  }

  const dataDir = process.env.TELEHUBX_DATA_DIR;
  if (dataDir && dataDir.trim()) {
    const dir = path.join(path.resolve(expandWinVars(dataDir)), 'logs');
    try { mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
    return dir;
  }

  // Dev fallback (relative). May still EPERM on Windows installs that
  // forget to set TELEHUBX_DATA_DIR; we keep this for dev workspace only.
  const dir = path.resolve(process.cwd(), 'logs');
  try { mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
  return dir;
}

@Injectable()
export class AppLoggerService extends ConsoleLogger {
  private readonly winston: winston.Logger;

  constructor() {
    super();
    const logDir = resolveLogDir();
    this.winston = winston.createLogger({
      level: process.env.LOG_LEVEL ?? 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
          silent: process.env.NODE_ENV === 'test',
        }),
        new (winston.transports as any).DailyRotateFile({
          filename: path.join(logDir, 'app-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
          maxSize: '20m',
          zippedArchive: true,
        }),
        new (winston.transports as any).DailyRotateFile({
          filename: path.join(logDir, 'error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxFiles: '30d',
          maxSize: '20m',
          zippedArchive: true,
        }),
      ],
    });
  }

  log(message: string, context?: string) {
    super.log(message, context);
    this.winston.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    super.error(message, trace, context);
    this.winston.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    super.warn(message, context);
    this.winston.warn(message, { context });
  }

  debug(message: string, context?: string) {
    super.debug(message, context);
    this.winston.debug(message, { context });
  }
}
