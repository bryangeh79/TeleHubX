import { SetMetadata } from '@nestjs/common';
import { UserRole } from './user.entity';

export const ROLES_KEY = 'roles';
export const ALLOW_AGENT_KEY = 'allowAgent';
export const AGENT_ONLY_KEY = 'agentOnly';

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

/**
 * Codex round-9 #1: 严格 agent-only — 拒绝所有非 AGENT 的访问 (普通用户/SUPER_ADMIN 都不行).
 * 用于 agent 私有内部 API: /tasks/dispatch, PATCH /tasks/:id (status/progress 回写) 等.
 *
 * 与 @AllowAgent() 区别:
 *   @AllowAgent()  : 允许 agent + 普通登录用户 (普通用户在没 @Roles 时可访问)
 *   @AgentOnly()   : 仅 agent, 其他全 403
 */
export const AgentOnly = () => SetMetadata(AGENT_ONLY_KEY, true);
