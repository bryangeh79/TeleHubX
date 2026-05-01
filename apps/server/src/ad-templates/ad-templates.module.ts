import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdTemplate } from './ad-template.entity';
import { PlatformAiConfig } from '../platform-config/platform-ai-config.entity';
import { AdTemplatesController } from './ad-templates.controller';
import { AdTemplatesService } from './ad-templates.service';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdTemplate, PlatformAiConfig]),
    AiAgentModule,
    PlatformConfigModule,
  ],
  controllers: [AdTemplatesController],
  providers: [AdTemplatesService],
  exports: [AdTemplatesService],
})
export class AdTemplatesModule {}
