import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CampaignStatus, PacePreset } from './campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { AuthUser, CurrentUser, isSuperAdmin } from '../auth/current-user.decorator';
import { AllowAgent } from '../auth/roles.decorator';
import { callerTenantId, resolveTenantIdSoft } from '../auth/tenant-resolver';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

function isAgentRequest(req: Request): boolean {
  return !!(req.headers['x-agent-token']);
}

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly service: CampaignsService,
    private readonly dispatch: CampaignDispatchService,
  ) {}

  /**
   * 创建 campaign。
   * Codex #2: 普通用户 dto.tenantId 强制覆盖为自己的 tenantId,
   *          SUPER_ADMIN 才允许 dto 自带 (跨租户管理)
   */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    const tid = isSuperAdmin(user) ? null : (user.tenantId ?? null);
    return this.service.create(dto, tid);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: CampaignStatus,
    @Query('tenantId') tid?: string,
  ) {
    return this.service.findAll(status, resolveTenantIdSoft(user, tid));
  }

  /** 预览调度计划（dry-run，不落库）
   *  Codex round-5 #3 #4: 必须传 tenantId 才能查到真实资源, 调度参数也透传 */
  @Post('dispatch-preview')
  @HttpCode(HttpStatus.OK)
  dispatchPreview(
    @CurrentUser() user: AuthUser,
    @Body() dto: {
      customerGroupIds?: string[];
      targets?: string[];
      pacePreset?: string;
      accountSourceMode?: string;
      adAccountIds?: string[];
      scheduleMode?: string;
      scheduledAt?: string;
      scheduleTime?: string;
      scheduleDayOfWeek?: number;
      tenantId?: string;
    },
  ) {
    return this.dispatch.preview({
      ...dto,
      tenantId: resolveTenantIdSoft(user, dto.tenantId),
    });
  }

  @Get('dashboard-stats')
  dashboardStats(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.dashboardStats(resolveTenantIdSoft(user, tenantId) ?? undefined);
  }

  @Get('capacity-check')
  capacityCheck(
    @CurrentUser() user: AuthUser,
    @Query('targetCount') targetCount?: string,
    @Query('pacePreset') pacePreset?: PacePreset,
    @Query('customerGroupIds') customerGroupIds?: string,
    @Query('extraTargets') extraTargets?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.capacityCheck({
      targetCount: targetCount ? parseInt(targetCount, 10) : 0,
      pacePreset,
      customerGroupIds: customerGroupIds ? customerGroupIds.split(',').filter(Boolean) : [],
      extraTargets: extraTargets ? extraTargets.split(',').filter(Boolean) : [],
      tenantId: resolveTenantIdSoft(user, tenantId),
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneScoped(id, callerTenantId(user));
  }

  @Get(':id/tasks')
  listTasks(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listTasks(id, callerTenantId(user));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.service.update(id, dto, callerTenantId(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id, callerTenantId(user));
  }

  @Post(':id/retry-failed')
  @HttpCode(HttpStatus.OK)
  retryFailed(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.retryFailedTasks(id, callerTenantId(user));
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    // 校验权属 + dispatch 内部还会再校验一次
    await this.service.findOneScoped(id, callerTenantId(user));
    const result = await this.dispatch.dispatch(id);
    return {
      queued: true,
      targets: result.targetCount,
      tasksCreated: result.tasksCreated,
      days: result.days,
      accountsUsed: result.accountsUsed,
    };
  }

  /** Agent 回写：单条发送完成 +1.
   *  Codex round-5 #1 加固:
   *  - 必须 X-Agent-Token (拒绝普通登录用户访问)
   *  - taskId 必传 (DTO 强制 + service 二次校验)
   *  - service 用 sentCountedAt 防重复回写
   */
  @Post(':id/sent')
  @AllowAgent()
  @HttpCode(HttpStatus.OK)
  incrementSent(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Body() body?: { delta?: number; taskId?: string },
  ) {
    if (!isAgentRequest(req)) {
      throw new ForbiddenException('此端点仅供 agent 回写');
    }
    if (!body?.taskId) {
      throw new BadRequestException('taskId 必填 (防 sentCount 被重复刷)');
    }
    return this.service.incrementSent(id, body?.delta ?? 1, body.taskId);
  }

  /** 客户回复 +1 */
  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  incrementReply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body?: { delta?: number; taskId?: string },
  ) {
    // 校验 campaign 权属
    return (async () => {
      await this.service.findOneScoped(id, callerTenantId(user));
      return this.service.incrementReply(id, body?.delta ?? 1, body?.taskId);
    })();
  }
}
