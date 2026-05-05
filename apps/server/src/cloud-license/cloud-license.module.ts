import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { Task } from '../tasks/task.entity';
import { CloudLicenseController } from './cloud-license.controller';
import { CloudLicenseService } from './cloud-license.service';

/**
 * Global so AccountsService and TasksService can inject CloudLicenseService
 * without each module importing CloudLicenseModule explicitly.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Account, Task])],
  controllers: [CloudLicenseController],
  providers: [CloudLicenseService],
  exports: [CloudLicenseService],
})
export class CloudLicenseModule {}
