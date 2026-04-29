import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarmupPlan } from './warmup-plan.entity';
import { WarmupService } from './warmup.service';

@Module({
  imports: [TypeOrmModule.forFeature([WarmupPlan])],
  providers: [WarmupService],
  exports: [WarmupService],
})
export class WarmupModule {}
