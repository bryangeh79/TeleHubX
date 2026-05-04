import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/account.entity';
import { AuthModule } from '../auth/auth.module';
import { User } from '../auth/user.entity';
import { LicensesModule } from '../licenses/licenses.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AdminController } from './admin.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, User]),
    TenantsModule,
    LicensesModule,
    AuthModule,
  ],
  controllers: [AdminController],
  providers: [UsersService],
})
export class AdminModule {}
