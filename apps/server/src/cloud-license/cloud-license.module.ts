import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../auth/user.entity';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CloudLicenseController } from './cloud-license.controller';
import { CloudLicenseService } from './cloud-license.service';
import { CloudLicenseAdminController } from './cloud-license-admin.controller';
import { CloudLicenseAdminService } from './cloud-license-admin.service';
import { LicenseGuard } from './license.guard';

/**
 * Global so AccountsService and TasksService can inject CloudLicenseService
 * without each module importing CloudLicenseModule explicitly.
 *
 * vmfix17 (Issue #24): imports AuthModule + TenantsModule + User repo so
 * activate() can provision a local login user from the License Worker's
 * activation response. Without this the dashboard /login flow has no
 * matching User row and the operator is locked out post-activation.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Account, Task, User]),
    AuthModule,
    TenantsModule,
  ],
  controllers: [CloudLicenseController, CloudLicenseAdminController],
  providers: [CloudLicenseService, CloudLicenseAdminService, LicenseGuard],
  exports: [CloudLicenseService, LicenseGuard],
})
export class CloudLicenseModule {}
