import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { CustomerGroupsModule } from '../customer-groups/customer-groups.module';
import { DiscoveredGroup } from '../discovered-groups/discovered-group.entity';
import { LeadCandidatesModule } from '../leads-candidates/leads-candidates.module';
import { Task } from './task.entity';
import { TaskTemplate } from './task-template.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TaskTemplatesController } from './task-templates.controller';
import { TaskTemplatesService } from './task-templates.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, TaskTemplate, Account, Campaign, DiscoveredGroup]),
    LeadCandidatesModule,
    CustomerGroupsModule,
  ],
  controllers: [TasksController, TaskTemplatesController],
  providers: [TasksService, TaskTemplatesService],
  exports: [TasksService, TaskTemplatesService],
})
export class TasksModule {}
