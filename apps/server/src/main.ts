import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, Logger, ValidationPipe } from '@nestjs/common';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { AppLoggerService } from './logger/app-logger.service';
import { QueryFailedExceptionFilter } from './common/filters/query-failed.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(AppLoggerService);
  app.useLogger(logger);

  app.enableShutdownHooks();
  app.use(compression());
  app.setGlobalPrefix('api/v1');

  // Codex round-11 #6: 生产环境必须用 CORS_ORIGINS 白名单, 不再全开放
  // dev (NODE_ENV != production): 全开方便本地;
  // prod: 必须设 CORS_ORIGINS=https://app.example.com,https://admin.example.com
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  if (isProd) {
    const originsRaw = process.env.CORS_ORIGINS ?? '';
    const allowedOrigins = originsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowedOrigins.length) {
      // eslint-disable-next-line no-console
      console.warn('[CORS] WARNING: production 环境未设 CORS_ORIGINS, 默认禁止跨域');
    }
    app.enableCors({
      origin: allowedOrigins.length ? allowedOrigins : false,
      credentials: true,
    });
  } else {
    app.enableCors();  // dev 全开
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new QueryFailedExceptionFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const port = process.env.APP_PORT || 9800;
  await app.listen(port);
  logger.log(`TeleHubX Server running on http://localhost:${port}/api/v1/health`, 'Bootstrap');

  const shutdown = async (signal: string) => {
    logger.warn(`Received ${signal}, shutting down gracefully…`, 'Bootstrap');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Fatal startup error', err?.stack);
  process.exit(1);
});
