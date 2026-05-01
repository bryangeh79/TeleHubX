import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GreetingTemplate } from './greeting-template.entity';
import { GreetingTemplatesController } from './greeting-templates.controller';
import { GreetingTemplatesService } from './greeting-templates.service';

@Module({
  imports: [TypeOrmModule.forFeature([GreetingTemplate])],
  controllers: [GreetingTemplatesController],
  providers: [GreetingTemplatesService],
  exports: [GreetingTemplatesService],
})
export class GreetingTemplatesModule {}
