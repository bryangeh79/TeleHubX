import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksModule } from '../tasks/tasks.module';
import { DiscoveredGroup } from './discovered-group.entity';
import { DiscoveredGroupsController } from './discovered-groups.controller';
import { DiscoveredGroupsService } from './discovered-groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([DiscoveredGroup]), TasksModule],
  controllers: [DiscoveredGroupsController],
  providers: [DiscoveredGroupsService],
  exports: [DiscoveredGroupsService],
})
export class DiscoveredGroupsModule {}
