import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentService } from './ai-agent.service';
import { AutoReplyDecider } from './decider.service';

@Module({
  imports: [KnowledgeModule],
  controllers: [AiAgentController],
  providers: [AiAgentService, AutoReplyDecider],
  exports: [AiAgentService, AutoReplyDecider],
})
export class AiAgentModule {}
