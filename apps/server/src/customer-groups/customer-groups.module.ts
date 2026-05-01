import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerGroup } from './customer-group.entity';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomerGroupsService } from './customer-groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerGroup])],
  controllers: [CustomerGroupsController],
  providers: [CustomerGroupsService],
  exports: [CustomerGroupsService],
})
export class CustomerGroupsModule {}
