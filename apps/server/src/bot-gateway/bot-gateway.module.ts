import { Module } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LeadsModule } from '../leads/leads.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BotGatewayController } from './bot-gateway.controller';
import { BotGatewayService } from './bot-gateway.service';
import { BotReplyService } from './bot-reply.service';
import { BotUpdateAdapter } from './bot-update.adapter';

@Module({
  imports: [TenantsModule, LeadsModule, AiAgentModule, KnowledgeModule],
  controllers: [BotGatewayController],
  providers: [BotGatewayService, BotReplyService, BotUpdateAdapter],
  exports: [BotGatewayService, BotReplyService],
})
export class BotGatewayModule {}
