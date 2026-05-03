import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { LicensesModule } from '../licenses/licenses.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    TenantsModule,
    LicensesModule,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
