import { SetMetadata } from '@nestjs/common';
import { UserRole } from './user.entity';

export const ROLES_KEY = 'roles';

/**
 * 限制端点访问的最低 role。在 controller 或 handler 上：
 *
 *   @Roles(UserRole.SUPER_ADMIN)
 *   @UseGuards(RolesGuard)  // (其实 RolesGuard 已注册为 APP_GUARD，无需手动加)
 *   adminOnly() { ... }
 *
 * 如果路由没有 @Roles，则任何登录用户都能访问。
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
