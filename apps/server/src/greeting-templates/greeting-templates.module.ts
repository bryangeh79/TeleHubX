import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GreetingTemplate } from './greeting-template.entity';
import { GreetingTemplatesController } from './greeting-templates.controller';
import { GreetingTemplatesService } from './greeting-templates.service';
import { PlatformConfigModule } from '../platform-config/platform-config.module';

@Module({
  imports: [TypeOrmModule.forFeature([GreetingTemplate]), PlatformConfigModule],
  controllers: [GreetingTemplatesController],
  providers: [GreetingTemplatesService],
  exports: [GreetingTemplatesService],
})
export class GreetingTemplatesModule {}
