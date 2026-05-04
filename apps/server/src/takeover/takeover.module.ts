import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BotGatewayModule } from '../bot-gateway/bot-gateway.module';
import { LeadsModule } from '../leads/leads.module';
import { TenantsModule } from '../tenants/tenants.module';
import { TakeoverController } from './takeover.controller';
import { TakeoverGateway } from './takeover.gateway';

@Module({
  imports: [LeadsModule, TenantsModule, BotGatewayModule, AuthModule],
  controllers: [TakeoverController],
  providers: [TakeoverGateway],
  exports: [TakeoverGateway],
})
export class TakeoverModule {}
