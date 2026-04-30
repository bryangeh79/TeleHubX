import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './account.entity';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { BindOrchestratorService } from './bind/bind.service';
import { ProxiesModule } from '../proxies/proxies.module';
import { SlotsModule } from '../slots/slots.module';
import { WarmupModule } from './warmup/warmup.module';

@Module({
  imports: [TypeOrmModule.forFeature([Account]), WarmupModule, SlotsModule, ProxiesModule],
  controllers: [AccountsController],
  providers: [AccountsService, BindOrchestratorService],
  exports: [AccountsService],
})
export class AccountsModule {}
