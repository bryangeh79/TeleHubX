import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { Task } from '../tasks/task.entity';
import { ExecutionGroup } from './execution-group.entity';
import { ExecutionGroupsController } from './execution-groups.controller';
import { ExecutionGroupsService } from './execution-groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExecutionGroup, Account, Task])],
  controllers: [ExecutionGroupsController],
  providers: [ExecutionGroupsService],
  exports: [ExecutionGroupsService],
})
export class ExecutionGroupsModule {}
