import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdTemplate } from './ad-template.entity';
import { AdTemplatesController } from './ad-templates.controller';
import { AdTemplatesService } from './ad-templates.service';
import { AiAgentModule } from '../ai-agent/ai-agent.module';

@Module({
  imports: [TypeOrmModule.forFeature([AdTemplate]), AiAgentModule],
  controllers: [AdTemplatesController],
  providers: [AdTemplatesService],
  exports: [AdTemplatesService],
})
export class AdTemplatesModule {}
