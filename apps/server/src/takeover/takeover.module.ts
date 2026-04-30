import { Module } from '@nestjs/common';
import { BotGatewayModule } from '../bot-gateway/bot-gateway.module';
import { LeadsModule } from '../leads/leads.module';
import { TenantsModule } from '../tenants/tenants.module';
import { TakeoverGateway } from './takeover.gateway';

@Module({
  imports: [LeadsModule, TenantsModule, BotGatewayModule],
  providers: [TakeoverGateway],
  exports: [TakeoverGateway],
})
export class TakeoverModule {}
