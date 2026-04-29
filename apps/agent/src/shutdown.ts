import { logger } from './logger';

type CleanupFn = () => Promise<void> | void;

const handlers: CleanupFn[] = [];

export function onShutdown(fn: CleanupFn): void {
  handlers.push(fn);
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — graceful shutdown starting`);
  for (const fn of handlers) {
    try {
      await fn();
    } catch (err) {
      logger.error('Cleanup error during shutdown:', err instanceof Error ? err : { err });
    }
  }
  logger.info('Shutdown complete');
  process.exit(0);
}

export function registerSignalHandlers(): void {
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', err);
    void shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason instanceof Error ? reason : { reason: String(reason) });
    // Log but do not exit — let the process continue
  });
}
