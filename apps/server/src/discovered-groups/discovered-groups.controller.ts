import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { AllowAgent } from '../auth/roles.decorator';
import { callerTenantId, resolveTenantIdSoft } from '../auth/tenant-resolver';
import { DiscoveredGroupStatus } from './discovered-group.entity';
import {
  DiscoveredGroupUpsertItem,
  DiscoveredGroupsService,
} from './discovered-groups.service';

@Controller('discovered-groups')
export class DiscoveredGroupsController {
  constructor(private readonly svc: DiscoveredGroupsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: DiscoveredGroupStatus,
    @Query('minQuality') minQuality?: string,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list({
      tenantId: resolveTenantIdSoft(user, tenantId) ?? undefined,
      status,
      minQuality: minQuality !== undefined ? parseInt(minQuality, 10) : undefined,
      keyword,
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.stats(resolveTenantIdSoft(user, tenantId) ?? undefined);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getByIdScoped(id, callerTenantId(user));
  }

  /** Agent discover_groups_by_keyword executor 调用 */
  @Post('bulk-upsert')
  @AllowAgent()
  @HttpCode(HttpStatus.OK)
  bulkUpsert(@Body() body: { tenantId: string; items: DiscoveredGroupUpsertItem[] }) {
    if (!body?.tenantId || !Array.isArray(body?.items)) {
      return { inserted: 0, updated: 0 };
    }
    return this.svc.bulkUpsert(body.tenantId, body.items);
  }

  /** 租户人工触发：派发 join + scrape 任务 */
  @Post(':id/queue-scrape')
  @HttpCode(HttpStatus.OK)
  async queueScrape(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { accountId: string },
  ) {
    await this.svc.getByIdScoped(id, callerTenantId(user));
    return this.svc.queueScrape(id, body.accountId);
  }

  @Post(':id/ignore')
  @HttpCode(HttpStatus.OK)
  async ignore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.getByIdScoped(id, callerTenantId(user));
    return this.svc.setStatus(id, DiscoveredGroupStatus.IGNORED);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.getByIdScoped(id, callerTenantId(user));
    return this.svc.setStatus(id, DiscoveredGroupStatus.NEW);
  }

  @Post('bulk-ignore')
  @HttpCode(HttpStatus.OK)
  bulkIgnore(@Body() body: { ids: string[] }) {
    return this.svc.bulkSetStatus(body?.ids ?? [], DiscoveredGroupStatus.IGNORED);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.getByIdScoped(id, callerTenantId(user));
    return this.svc.remove(id);
  }
}
