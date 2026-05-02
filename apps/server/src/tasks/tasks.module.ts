import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { LeadCandidatesModule } from '../leads-candidates/leads-candidates.module';
import { Task } from './task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task, Account, Campaign]), LeadCandidatesModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
