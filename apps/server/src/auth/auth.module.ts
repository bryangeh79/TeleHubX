import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { User } from './user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User]), TenantsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // JwtAuthGuard 第一道：所有非 @Public 路由必须有 token
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // RolesGuard 第二道：标了 @Roles() 的端点检查角色
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
