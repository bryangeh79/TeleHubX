import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from './user.entity';

export interface AuthUser {
  sub: string;
  username: string;
  role: UserRole | 'AGENT';
  tenantId: string | null;
  iat?: number;
  exp?: number;
}

/**
 * 控制器参数装饰器：拿 JwtAuthGuard 注入到 req.user 上的用户信息。
 *
 *   foo(@CurrentUser() user: AuthUser) { ... }
 *
 * agent 通道下 user.role === 'AGENT'，user.tenantId === null，
 * 控制器需自行从 body 拿 tenantId（agent 一个进程服务多个租户）。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);

/** Super admin / SaaS 平台管理员（可跨租户读取所有数据）。 */
export function isSuperAdmin(user: AuthUser): boolean {
  return user.role === ('SUPER_ADMIN' as UserRole);
}

/** Agent 通道（X-Agent-Token），不属于任何租户。 */
export function isAgent(user: AuthUser): boolean {
  return user.role === 'AGENT';
}
