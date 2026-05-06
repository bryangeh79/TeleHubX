import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CloudLicenseService } from './cloud-license.service';

export type LicenseGateAction = 'add_account' | 'run_task';

export const LICENSE_GATE_KEY = 'license_gate';

/**
 * Declarative wrapper over the existing imperative gates
 * (CloudLicenseService.canAddAccount / canRunTasks).
 *
 * Apply via @LicenseGate('add_account') or @LicenseGate('run_task').
 * Throws 403 with structured payload {code, reason, effectiveStatus}
 * so dashboard axios interceptor can pop the LicenseLockedModal.
 *
 * Existing imperative checks in accounts.service / tasks.service stay —
 * this Guard is for new mutation endpoints added going forward.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cloudLicense: CloudLicenseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<LicenseGateAction>(
      LICENSE_GATE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!action) return true; // not gated → pass

    const gate =
      action === 'add_account'
        ? await this.cloudLicense.canAddAccount()
        : this.cloudLicense.canRunTasks();

    if (gate.ok) return true;

    throw new ForbiddenException({
      code: 'LICENSE_LOCKED',
      reason: gate.reason ?? 'license_blocked',
      effectiveStatus: gate.effectiveStatus,
    });
  }
}
