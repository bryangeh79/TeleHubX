import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerGroup } from './customer-group.entity';
import { LeadCandidate } from '../leads-candidates/lead-candidate.entity';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomerGroupsService } from './customer-groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerGroup, LeadCandidate])],
  controllers: [CustomerGroupsController],
  providers: [CustomerGroupsService],
  exports: [CustomerGroupsService],
})
export class CustomerGroupsModule {}
