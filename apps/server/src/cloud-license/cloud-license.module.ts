import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { Task } from '../tasks/task.entity';
import { CloudLicenseController } from './cloud-license.controller';
import { CloudLicenseService } from './cloud-license.service';
import { CloudLicenseAdminController } from './cloud-license-admin.controller';
import { CloudLicenseAdminService } from './cloud-license-admin.service';

/**
 * Global so AccountsService and TasksService can inject CloudLicenseService
 * without each module importing CloudLicenseModule explicitly.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Account, Task])],
  controllers: [CloudLicenseController, CloudLicenseAdminController],
  providers: [CloudLicenseService, CloudLicenseAdminService],
  exports: [CloudLicenseService],
})
export class CloudLicenseModule {}
