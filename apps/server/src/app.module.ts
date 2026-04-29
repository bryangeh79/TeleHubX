import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';
import { AccountsModule } from './accounts/accounts.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { LeadsModule } from './leads/leads.module';
import { AiAgentModule } from './ai-agent/ai-agent.module';
import { ProxiesModule } from './proxies/proxies.module';
import { SlotsModule } from './slots/slots.module';
import { RedisModule } from './redis/redis.module';
import { LoggerModule } from './logger/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Project-root .env (cwd when pm2 launches dist/main.js is apps/server)
      envFilePath: ['../../.env', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5433),
        username: config.get('DB_USER', 'telehubx'),
        password: config.get('DB_PASSWORD', 'telehubx'),
        database: config.get('DB_NAME', 'telehubx'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development',
      }),
    }),
    LoggerModule,
    RedisModule,
    DatabaseModule,
    AccountsModule,
    CampaignsModule,
    LeadsModule,
    AiAgentModule,
    ProxiesModule,
    SlotsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
