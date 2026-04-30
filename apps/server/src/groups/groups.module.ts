import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantTestGroup } from './tenant-test-group.entity';
import { TenantTestGroupsController } from './tenant-test-groups.controller';
import { TenantTestGroupsService } from './tenant-test-groups.service';
import { TenantsModule } from '../tenants/tenants.module';

@Module({
  imports: [TypeOrmModule.forFeature([TenantTestGroup]), TenantsModule],
  controllers: [TenantTestGroupsController],
  providers: [TenantTestGroupsService],
  exports: [TenantTestGroupsService],
})
export class GroupsModule {}
