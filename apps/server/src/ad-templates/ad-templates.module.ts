import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdTemplate } from './ad-template.entity';
import { AdTemplatesController } from './ad-templates.controller';
import { AdTemplatesService } from './ad-templates.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdTemplate])],
  controllers: [AdTemplatesController],
  providers: [AdTemplatesService],
  exports: [AdTemplatesService],
})
export class AdTemplatesModule {}
