import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser, isAgent, isSuperAdmin } from './current-user.decorator';

/**
 * 多租户行级隔离统一入口。所有 controller 用这个解析"当前请求应该用哪个 tenantId"。
 *
 * 规则：
 *   - SUPER_ADMIN：可显式传 query/body.tenantId 跨租户查；不传则用自己的
 *   - AGENT (X-Agent-Token)：必须显式传 tenantId（agent 一个进程服务多租户）
 *   - 普通用户：fallback 一律忽略，强制用 user.tenantId
 */
export function resolveTenantId(user: AuthUser, fallback?: string | null): string {
  if (isAgent(user)) {
    if (!fallback) throw new BadRequestException('agent calls must provide tenantId');
    return fallback;
  }
  if (isSuperAdmin(user)) {
    return fallback ?? user.tenantId ?? '';
  }
  if (!user.tenantId) throw new ForbiddenException('user has no tenantId — relogin required');
  return user.tenantId;
}

/**
 * 软版本：返回可能为 null（用于 list 端点 SUPER_ADMIN 想看全量数据时）。
 * 普通用户仍强制用自己的 tenantId。
 */
export function resolveTenantIdSoft(user: AuthUser, fallback?: string | null): string | null {
  if (isAgent(user)) return fallback ?? null;
  if (isSuperAdmin(user)) return fallback ?? user.tenantId ?? null;
  return user.tenantId ?? null;
}
