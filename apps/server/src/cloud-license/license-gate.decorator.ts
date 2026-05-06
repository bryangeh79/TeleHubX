import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { LicenseGuard, LICENSE_GATE_KEY, LicenseGateAction } from './license.guard';

/**
 * 在 controller method 上声明该路由受 cloud-license 保护。
 *
 * 用法：
 *   @LicenseGate('add_account')
 *   @Post()
 *   create(...) { ... }
 *
 * 当 license 处于 locked / unconfigured / 配额超限时返回 403。
 * 只读路由不要加，让历史数据始终可查。
 */
export const LicenseGate = (action: LicenseGateAction) =>
  applyDecorators(SetMetadata(LICENSE_GATE_KEY, action), UseGuards(LicenseGuard));
