import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { BotGatewayModule } from '../bot-gateway/bot-gateway.module';
import { Proxy } from '../proxies/proxy.entity';
import { ProxiesModule } from '../proxies/proxies.module';
import { Task } from '../tasks/task.entity';
import { TenantBot } from '../tenants/tenant-bot.entity';
import { TenantsModule } from '../tenants/tenants.module';
import { MaintenanceController } from './maintenance.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, TenantBot, Proxy, Task]),
    AccountsModule,
    ProxiesModule,
    TenantsModule,
    BotGatewayModule,
  ],
  controllers: [MaintenanceController],
})
export class MaintenanceModule {}
