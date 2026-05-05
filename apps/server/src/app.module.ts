import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { DatabaseModule } from './database/database.module';
import { AccountsModule } from './accounts/accounts.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ChatScriptsModule } from './chat-scripts/chat-scripts.module';
import { LeadsModule } from './leads/leads.module';
import { AiAgentModule } from './ai-agent/ai-agent.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ProxiesModule } from './proxies/proxies.module';
import { SlotsModule } from './slots/slots.module';
import { TenantsModule } from './tenants/tenants.module';
import { LicensesModule } from './licenses/licenses.module';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { LoggerModule } from './logger/logger.module';
import { BotGatewayModule } from './bot-gateway/bot-gateway.module';
import { TasksModule } from './tasks/tasks.module';
import { ExecutionGroupsModule } from './execution-groups/execution-groups.module';
import { TakeoverModule } from './takeover/takeover.module';
import { AssetsModule } from './assets/assets.module';
import { GroupsModule } from './groups/groups.module';
import { LeadCandidatesModule } from './leads-candidates/leads-candidates.module';
import { CustomerGroupsModule } from './customer-groups/customer-groups.module';
import { DiscoveredGroupsModule } from './discovered-groups/discovered-groups.module';
import { AdTemplatesModule } from './ad-templates/ad-templates.module';
import { GreetingTemplatesModule } from './greeting-templates/greeting-templates.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { AdminModule } from './admin/admin.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { CloudLicenseModule } from './cloud-license/cloud-license.module';

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
      useFactory: (config: ConfigService) => {
        // 默认 false，防止生产环境误 DROP/ALTER。
        // 仅当 TYPEORM_SYNC=true 显式开启时才走 synchronize 自动同步 schema。
        // 生产环境必须保持 false，schema 演进走 typeorm migration:run (data-source.ts)。
        const sync = config.get<string>('TYPEORM_SYNC') === 'true';
        const isProd = (config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production';
        if (sync && isProd) {
          // eslint-disable-next-line no-console
          console.warn(
            '[TypeORM] WARNING: TYPEORM_SYNC=true in production — schema 会被自动同步，可能 DROP 数据。强烈不推荐。',
          );
        }
        return {
          type: 'postgres',
          host: config.get('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5436),
          username: config.get('DB_USER', 'telehubx'),
          password: config.get('DB_PASSWORD', 'telehubx'),
          database: config.get('DB_NAME', 'telehubx'),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: sync,
          logging: config.get('NODE_ENV') === 'development',
        };
      },
    }),
    LoggerModule,
    RedisModule,
    DatabaseModule,
    AccountsModule,
    CampaignsModule,
    ChatScriptsModule,
    LeadsModule,
    AiAgentModule,
    ProxiesModule,
    SlotsModule,
    KnowledgeModule,
    TenantsModule,
    LicensesModule,
    AuthModule,
    BotGatewayModule,
    TasksModule,
    ExecutionGroupsModule,
    TakeoverModule,
    AssetsModule,
    GroupsModule,
    LeadCandidatesModule,
    CustomerGroupsModule,
    DiscoveredGroupsModule,
    AdTemplatesModule,
    GreetingTemplatesModule,
    PlatformConfigModule,
    AdminModule,
    MaintenanceModule,
    CloudLicenseModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
