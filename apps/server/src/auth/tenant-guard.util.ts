import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * 租户权属保护：检查实体是否属于 caller 的租户。
 *
 * 用法（在 service 内）：
 *   async findOneScoped(id: string, callerTenantId: string | null): Promise<Account> {
 *     const x = await this.repo.findOneBy({ id });
 *     return ensureTenant(x, callerTenantId, 'Account');
 *   }
 *
 * 规则：
 *   - 实体不存在 → NotFoundException
 *   - callerTenantId === null → 管理员/agent 模式直通（调用方负责确认权限）
 *   - 实体 tenantId 不匹配 → ForbiddenException（不暴露存在与否）
 */
export function ensureTenant<T extends { tenantId?: string | null }>(
  entity: T | null | undefined,
  callerTenantId: string | null,
  entityName = 'Resource',
): T {
  if (!entity) throw new NotFoundException(`${entityName} not found`);
  // 管理员模式（callerTenantId=null）跳过校验
  if (callerTenantId === null) return entity;
  // 实体本身没 tenantId 字段（共享数据如 platform_settings）
  if (!entity.tenantId) return entity;
  if (entity.tenantId !== callerTenantId) {
    throw new ForbiddenException(`${entityName} access denied (tenant mismatch)`);
  }
  return entity;
}
