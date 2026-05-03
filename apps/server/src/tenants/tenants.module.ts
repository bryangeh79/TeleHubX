import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { TenantBot } from './tenant-bot.entity';
import { TenantSettings } from './tenant-settings.entity';
import { GreetingTemplate } from '../greeting-templates/greeting-template.entity';
import { BotReplyService } from '../bot-gateway/bot-reply.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantBot, TenantSettings, GreetingTemplate])],
  controllers: [TenantsController],
  providers: [TenantsService, BotReplyService],
  exports: [TenantsService],
})
export class TenantsModule {}
