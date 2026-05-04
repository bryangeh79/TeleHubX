import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser, isAgent, isSuperAdmin } from '../auth/current-user.decorator';
import { AllowAgent } from '../auth/roles.decorator';
import { CandidateStatus } from './lead-candidate.entity';
import { BulkUpsertItem, LeadCandidatesService } from './leads-candidates.service';

/**
 * 租户隔离规则：
 *   - SUPER_ADMIN：可显式传 query.tenantId 跨租户查；不传则用自己的
 *   - AGENT：必须传 body.tenantId / query.tenantId（agent 一个进程服务多租户）
 *   - 普通用户：query.tenantId 一律忽略，强制用 user.tenantId
 */
function resolveTenantId(user: AuthUser, fallback?: string): string {
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

@Controller('lead-candidates')
export class LeadCandidatesController {
  constructor(private readonly service: LeadCandidatesService) {}

  /**
   * agent 群成员爬取专用：批量写入候选池。
   * body: { tenantId, items: BulkUpsertItem[] }
   */
  @Post('bulk-upsert')
  @AllowAgent()
  bulkUpsert(
    @CurrentUser() user: AuthUser,
    @Body() body: { tenantId: string; items: BulkUpsertItem[] },
  ) {
    const tenantId = resolveTenantId(user, body.tenantId);
    return this.service.bulkUpsert(tenantId, body.items ?? []);
  }

  @Get('pending')
  listPending(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listPending(resolveTenantId(user, q), limit ? parseInt(limit, 10) : 50);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') q?: string,
    @Query('status') status?: CandidateStatus,
    @Query('onlyUnpacked') onlyUnpacked?: string,
  ) {
    return this.service.findAll(resolveTenantId(user, q), status, onlyUnpacked === 'true');
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query('tenantId') q?: string) {
    return this.service.stats(resolveTenantId(user, q));
  }

  /** 候选池按来源群分组 (任务详情 Modal 显示「来自哪几个群」) */
  @Get('hunt-sources')
  huntSources(@Query('huntTaskId') huntTaskId: string) {
    return this.service.groupSourcesByHunt(huntTaskId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** 标记已联系（agent 触达完成后回写）。 */
  @Post(':id/mark-contacted')
  @AllowAgent()
  markContacted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { contactedByAccountId: string; contactTaskId?: string },
  ) {
    return this.service.markContacted(id, body.contactedByAccountId, body.contactTaskId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
