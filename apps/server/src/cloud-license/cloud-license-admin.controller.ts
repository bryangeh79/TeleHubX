import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user.entity';
import { CloudLicenseAdminService } from './cloud-license-admin.service';

/**
 * SUPER_ADMIN-only proxy to the Cloudflare License Worker admin routes.
 *
 * The browser must NEVER hold the Worker ADMIN_TOKEN. The local server
 * holds it via env LICENSE_ADMIN_TOKEN and forwards calls.
 */
@Roles(UserRole.SUPER_ADMIN)
@Controller('cloud-license/admin')
export class CloudLicenseAdminController {
  constructor(private readonly svc: CloudLicenseAdminService) {}

  // GET /cloud-license/admin/availability  → did the operator set the token?
  @Get('availability')
  availability() {
    return { available: this.svc.available() };
  }

  // ── Tenants / Licenses ─────────────────────────────────────────────────
  @Post('tenants')
  @HttpCode(HttpStatus.OK)
  createTenant(@Body() body: any) {
    return this.svc.createLicense(body);
  }

  @Get('licenses')
  listLicenses() { return this.svc.listLicenses(); }

  @Get('users')
  listUsers() { return this.svc.listUsers(); }

  // ── License operations ─────────────────────────────────────────────────
  @Post('licenses/:id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@Param('id') id: string) { return this.svc.revokeLicense(id); }

  @Post('licenses/:id/extend')
  @HttpCode(HttpStatus.OK)
  extend(@Param('id') id: string, @Body() body: { expiresAt: string }) {
    return this.svc.extendLicense(id, body?.expiresAt);
  }

  @Post('licenses/:id/unbind')
  @HttpCode(HttpStatus.OK)
  unbind(@Param('id') id: string) { return this.svc.unbindLicense(id); }

  @Post('licenses/:id/change-plan')
  @HttpCode(HttpStatus.OK)
  changePlan(@Param('id') id: string, @Body() body: { plan: 'basic' | 'pro' | 'enterprise' }) {
    return this.svc.changePlan(id, body?.plan);
  }

  // ── Tenant users ───────────────────────────────────────────────────────
  @Post('tenants/:tenantId/users')
  @HttpCode(HttpStatus.OK)
  attachUser(@Param('tenantId') tenantId: string, @Body() body: { email: string; password: string; role?: string }) {
    return this.svc.attachUser(tenantId, body);
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPwd(@Param('id') id: string) { return this.svc.resetUserPassword(id); }

  @Post('users/:id/disable')
  @HttpCode(HttpStatus.OK)
  disable(@Param('id') id: string) { return this.svc.disableUser(id); }

  @Post('users/:id/enable')
  @HttpCode(HttpStatus.OK)
  enable(@Param('id') id: string) { return this.svc.enableUser(id); }
}
