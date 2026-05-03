import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from './current-user.decorator';
import { ROLES_KEY } from './roles.decorator';
import { UserRole } from './user.entity';

/**
 * 角色守卫 — 配合 @Roles() 装饰器使用。注册为 APP_GUARD 后所有路由生效。
 * - 端点没标 @Roles → 任何登录用户都过（保留原行为）
 * - 端点标了 @Roles(SUPER_ADMIN) → 必须是 super_admin 才放行
 * - AGENT 角色（X-Agent-Token）默认拒绝有 @Roles 限制的端点（避免越权）
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('No user context');
    if (!required.includes(user.role as UserRole)) {
      throw new ForbiddenException(`requires role: ${required.join(' / ')}`);
    }
    return true;
  }
}
