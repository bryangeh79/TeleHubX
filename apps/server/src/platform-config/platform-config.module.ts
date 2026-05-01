import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAiConfig } from './platform-ai-config.entity';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { AiAgentService } from '../ai-agent/ai-agent.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformAiConfig]), AiAgentModule],
  controllers: [PlatformConfigController],
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule implements OnModuleInit {
  constructor(
    private readonly platformConfigService: PlatformConfigService,
    private readonly aiAgentService: AiAgentService,
  ) {}

  onModuleInit() {
    // Wire DB config into AI service without circular dependency
    this.aiAgentService.platformConfigService = this.platformConfigService;
  }
}
