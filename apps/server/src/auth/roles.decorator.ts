import { SetMetadata } from '@nestjs/common';
import { UserRole } from './user.entity';

export const ROLES_KEY = 'roles';
export const ALLOW_AGENT_KEY = 'allowAgent';

/**
 * 限制端点访问的最低 role。在 controller 或 handler 上：
 *
 *   @Roles(UserRole.SUPER_ADMIN)
 *   adminOnly() { ... }
 *
 * 如果路由没有 @Roles，普通登录用户都能访问，但 AGENT 默认被拒绝（白名单制）。
 * 要让 AGENT 调某端点，必须显式贴 @AllowAgent()。
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * 允许 X-Agent-Token (AGENT 通道) 调用此端点。AGENT 默认被 RolesGuard 拒绝任何端点。
 * 用法：
 *   @AllowAgent()
 *   @Post('bulk-upsert')
 *   bulkUpsert() { ... }
 */
export const AllowAgent = () => SetMetadata(ALLOW_AGENT_KEY, true);
