import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, Logger, ValidationPipe } from '@nestjs/common';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { AppLoggerService } from './logger/app-logger.service';
import { QueryFailedExceptionFilter } from './common/filters/query-failed.filter';

// =============================================================================
// vmfix7 (Issue #14): SYNCHRONOUS startup diagnostics
//
// supervisor pipes child stderr -> server.log. We write every milestone and
// every fatal directly to stderr (and stdout for some) using process.stderr.write
// SYNC so the line lands in server.log even if process.exit fires immediately
// after. NestJS Logger uses async transports — fatal errors written through
// Logger.error were getting truncated when bootstrap() rejected and we
// process.exit(1) too quickly to flush.
// =============================================================================

function ts(): string { return new Date().toISOString(); }

function emit(level: 'INFO' | 'WARN' | 'FATAL', tag: string, msg: string): void {
  const line = `${ts()} [${level}] [${tag}] ${msg}\n`;
  // Write to BOTH streams. supervisor pipes both into server.log; redundancy
  // is cheap and guarantees visibility on partial-flush exits.
  try { process.stderr.write(line); } catch { /* ignore */ }
  try { process.stdout.write(line); } catch { /* ignore */ }
}

function emitFatal(tag: string, err: unknown): void {
  const e = err as Error & { code?: string };
  const stack = e?.stack ?? String(err);
  emit('FATAL', tag, stack.replace(/\n/g, ' || '));
}

// Install process-level handlers FIRST, before any import-time side effects
// from AppModule can crash silently. These ensure no exit is ever silent.
process.on('uncaughtException', (err) => {
  emitFatal('uncaughtException', err);
  // Give the OS a beat to flush the write before exiting.
  setTimeout(() => process.exit(70), 50).unref();
});
process.on('unhandledRejection', (reason) => {
  emitFatal('unhandledRejection', reason);
  setTimeout(() => process.exit(71), 50).unref();
});
process.on('beforeExit', (code) => {
  // beforeExit fires when event loop is empty AND no other exit hook
  // scheduled work. For an HTTP server this normally never fires.
  emit('WARN', 'beforeExit', `event loop empty, code=${code} — server should not have idled`);
});
process.on('exit', (code) => {
  emit('INFO', 'exit', `process exiting code=${code}`);
});

emit('INFO', 'bootstrap', `node=${process.version} pid=${process.pid} cwd=${process.cwd()}`);
emit('INFO', 'bootstrap', `env: NODE_ENV=${process.env.NODE_ENV ?? '(unset)'} APP_PORT=${process.env.APP_PORT ?? '(unset)'} TELEHUBX_DATA_DIR=${process.env.TELEHUBX_DATA_DIR ?? '(unset)'}`);

// Auto-default CORS_ORIGINS for local installer when prod mode + no explicit
// override. supervisor also passes this in subprocessEnv as belt-and-suspenders.
if (
  (process.env.NODE_ENV ?? '').toLowerCase() === 'production'
  && !process.env.CORS_ORIGINS
) {
  const dashPort = process.env.DASHBOARD_PORT ?? '9601';
  const fallback = [
    `http://127.0.0.1:${dashPort}`,
    `http://localhost:${dashPort}`,
  ].join(',');
  process.env.CORS_ORIGINS = fallback;
  emit('INFO', 'bootstrap', `CORS_ORIGINS not set; defaulted to local dashboard: ${fallback}`);
}

async function bootstrap() {
  emit('INFO', 'bootstrap', 'NestFactory.create start');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  emit('INFO', 'bootstrap', 'NestFactory.create done');

  const logger = app.get(AppLoggerService);
  app.useLogger(logger);
  emit('INFO', 'bootstrap', 'logger attached');

  app.enableShutdownHooks();
  app.use(compression());
  emit('INFO', 'bootstrap', 'compression enabled');

  // Exclude /health from the global prefix so supervisor can probe a stable
  // path without knowing the API version. /api/v1/health remains for clients.
  app.setGlobalPrefix('api/v1', { exclude: ['/health', '/'] });
  emit('INFO', 'bootstrap', 'global prefix set (api/v1, /health excluded)');

  // CORS — production: read CORS_ORIGINS (auto-defaulted above for local install).
  // Missing / empty is a WARN, never fatal. dev: open.
  emit('INFO', 'bootstrap', 'CORS setup start');
  try {
    const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    if (isProd) {
      const originsRaw = process.env.CORS_ORIGINS ?? '';
      const allowedOrigins = originsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      if (!allowedOrigins.length) {
        emit('WARN', 'bootstrap', 'CORS_ORIGINS empty in production — same-origin only');
      }
      app.enableCors({
        origin: allowedOrigins.length ? allowedOrigins : false,
        credentials: true,
      });
    } else {
      app.enableCors();
    }
    emit('INFO', 'bootstrap', 'CORS setup done');
  } catch (err) {
    emitFatal('CORS setup', err);
    throw err;
  }

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  emit('INFO', 'bootstrap', 'validation pipe set');

  app.useGlobalFilters(new QueryFailedExceptionFilter());
  emit('INFO', 'bootstrap', 'global filters set');

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  emit('INFO', 'bootstrap', 'global interceptors set');

  const port = Number(process.env.APP_PORT || 9800);
  emit('INFO', 'bootstrap', `about to app.listen(${port})`);
  await app.listen(port);
  emit('INFO', 'bootstrap', `app.listen resolved on port ${port}`);

  // Sanity probe so we know the kernel really gave us the port.
  try {
    const url = await app.getUrl();
    emit('INFO', 'bootstrap', `server URL: ${url} (health: /health and /api/v1/health)`);
  } catch (err) {
    emit('WARN', 'bootstrap', `getUrl() failed: ${(err as Error).message}`);
  }

  logger.log(`TeleHubX Server running on http://localhost:${port}/api/v1/health`, 'Bootstrap');

  const shutdown = async (signal: string) => {
    emit('INFO', 'shutdown', `received ${signal}`);
    try { await app.close(); } catch (err) { emitFatal('shutdown', err); }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  emitFatal('bootstrap', err);
  // Also try Nest's logger in case it's wired
  try { new Logger('Bootstrap').error('Fatal startup error', (err as Error)?.stack); } catch { /* ignore */ }
  // Delay exit briefly to ensure stderr/stdout drains to file.
  setTimeout(() => process.exit(1), 100).unref();
});
