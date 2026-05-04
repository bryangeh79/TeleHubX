import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, isAgent, isSuperAdmin } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AGENT_ONLY_KEY, ALLOW_AGENT_KEY, ROLES_KEY } from './roles.decorator';
import { UserRole } from './user.entity';

/**
 * 角色守卫 — 配合 @Roles() / @AllowAgent() 装饰器。注册为 APP_GUARD 全局生效。
 *
 * 规则：
 * - AGENT (X-Agent-Token) 默认**禁止**访问任何端点，只能访问标了 @AllowAgent() 的
 * - SUPER_ADMIN 默认能访问所有端点（即使没标 @Roles）
 * - 普通登录用户：没标 @Roles 时可访问；标了则必须 role 在列表里
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // @Public() 端点（如 login / health）跳过角色检查
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const allowAgent = this.reflector.getAllAndOverride<boolean>(ALLOW_AGENT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // Codex round-9 #1: @AgentOnly 严格 agent 专属, 其他全 403 (含 SUPER_ADMIN)
    const agentOnly = this.reflector.getAllAndOverride<boolean>(AGENT_ONLY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('No user context');

    // @AgentOnly: 只有 AGENT 能进, 其他全拒
    if (agentOnly) {
      if (!isAgent(user)) {
        throw new ForbiddenException('endpoint is agent-only (X-Agent-Token required)');
      }
      return true;
    }

    // AGENT 通道：默认拒绝，只放行标了 @AllowAgent() 或 @AgentOnly() 的端点
    if (isAgent(user)) {
      if (!allowAgent) {
        throw new ForbiddenException('agent token cannot access this endpoint');
      }
      return true;
    }

    // SUPER_ADMIN 直通
    if (isSuperAdmin(user)) return true;

    // 普通用户：没 @Roles 限制则放行
    if (!required || required.length === 0) return true;

    if (!required.includes(user.role as UserRole)) {
      throw new ForbiddenException(`requires role: ${required.join(' / ')}`);
    }
    return true;
  }
}
