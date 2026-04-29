import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

@Injectable()
export class AppLoggerService extends ConsoleLogger {
  private readonly winston: winston.Logger;

  constructor() {
    super();
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
          filename: 'logs/app-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: '14d',
          maxSize: '20m',
          zippedArchive: true,
        }),
        new (winston.transports as any).DailyRotateFile({
          filename: 'logs/error-%DATE%.log',
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
