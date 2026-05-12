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

  /**
   * vmfix27 #C4 / #D1: 返回最近 N 小时内同关键词已发现的 tgChatId 集合。
   * agent 跑 discover_groups_by_keyword 前调用此端点 → 跳过已知群（增量）。
   * 同时充当 24h cache：若 withinHours=24 + 返回非空，agent 可判断「该关键词最近搜过」.
   */
  @Get('recent')
  @AllowAgent()
  async recent(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId: string,
    @Query('keyword') keyword: string,
    @Query('withinHours') withinHours?: string,
  ): Promise<{ tgChatIds: string[]; lastDiscoveredAt: string | null; count: number }> {
    const tid = resolveTenantIdSoft(user, tenantId) ?? undefined;
    if (!tid || !keyword) return { tgChatIds: [], lastDiscoveredAt: null, count: 0 };
    const hrs = withinHours ? Math.max(1, Math.min(168, parseInt(withinHours, 10))) : 24;
    return this.svc.findRecentByKeyword(tid, keyword, hrs);
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

  /**
   * vmfix27 #C6: 批量派发 — 一次给 N 个 discovered_groups 创建 join + scrape 任务对.
   * 默认按 accountId 分配；返回每个群对应的 taskIds.
   */
  @Post('batch-queue-scrape')
  @HttpCode(HttpStatus.OK)
  async batchQueueScrape(
    @CurrentUser() user: AuthUser,
    @Body() body: { ids: string[]; accountId: string },
  ) {
    const results: Array<{ id: string; joinTaskId?: string; scrapeTaskId?: string; error?: string }> = [];
    const tid = callerTenantId(user);
    for (const id of body.ids ?? []) {
      try {
        await this.svc.getByIdScoped(id, tid);
        const r = await this.svc.queueScrape(id, body.accountId);
        results.push({ id, ...r });
      } catch (err: any) {
        results.push({ id, error: err?.message ?? String(err) });
      }
    }
    return {
      total: results.length,
      ok: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error).length,
      results,
    };
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
