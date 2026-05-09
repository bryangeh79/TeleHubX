import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user.entity';
import { PlatformSettingsService } from './platform-settings.service';

/**
 * vmfix23 (Issue #31): platform-wide (non-tenant) settings.
 *
 * Currently only Telegram MTProto API credentials. ADMIN-level access
 * (not SUPER_ADMIN — the tenant operator of a single-tenant install IS
 * the admin and must be able to configure their own TG app credentials
 * without going through a separate platform operator).
 *
 * Phase 6 will move to per-tenant settings; this is the bridge.
 */
@Controller('platform-settings')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  /**
   * GET status. Returns whether TG API is configured and the masked
   * apiHash for display purposes. Never returns the full hash.
   */
  @Get('tg-api')
  getTgApi() {
    return this.settings.getTgApi();
  }

  /**
   * POST new TG API ID + Hash. Writes .env, schedules a detached service
   * restart in ~3 seconds. Frontend should poll /health and expect ready
   * within ~90 seconds (warm restart with no schema changes).
   */
  @Post('tg-api')
  @HttpCode(HttpStatus.ACCEPTED)
  async saveTgApi(@Body() body: { apiId: number; apiHash: string }) {
    return this.settings.saveTgApiAndRestart(body.apiId, body.apiHash);
  }
}
