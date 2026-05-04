import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser, isAgent, isSuperAdmin } from '../auth/current-user.decorator';
import { AgentOnly, AllowAgent } from '../auth/roles.decorator';
import { callerTenantId } from '../auth/tenant-resolver';
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { TaskStatus, TaskType } from './task.entity';
import { TasksService } from './tasks.service';

/** Same isolation rules as LeadCandidatesController. */
function effectiveTenantId(user: AuthUser, override?: string): string | undefined {
  if (isAgent(user)) return override; // agent dispatch 不限定 tenant
  if (isSuperAdmin(user)) return override ?? user.tenantId ?? undefined;
  return user.tenantId ?? undefined;
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto) {
    const tenantId = effectiveTenantId(user);
    return this.service.create(dto, tenantId);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: TaskStatus,
    @Query('type') type?: TaskType,
    @Query('tenantId') tenantIdOverride?: string,
  ) {
    return this.service.findAll({
      status,
      type,
      tenantId: effectiveTenantId(user, tenantIdOverride),
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query('tenantId') override?: string) {
    return this.service.stats(effectiveTenantId(user, override));
  }

  /**
   * Agent 调度：领一批可执行任务（POST 因为有副作用：marks running）。
   * 请求 body: { accountIds: string[], limit?: number }
   * agent 通道，不做租户隔离（一个 agent 进程服务多租户）。
   */
  @Post('dispatch')
  @AgentOnly()  // Codex round-9 #1: 严格 agent-only, 普通用户调用 403
  dispatch(@Body() body: { accountIds: string[]; limit?: number }) {
    return this.service.dispatchToAgent(body.accountIds ?? [], body.limit);
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneScoped(id, callerTenantId(user));
  }

  /** preset_* 父任务下的所有子任务 (按时间正序) */
  @Get(':id/children')
  async findChildren(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.findChildren(id);
  }

  /** Codex round-9 #1: 严格 agent-only — 仅 agent 可 PATCH 状态/进度.
   *  普通用户用 /pause /resume /retry /cancel 等专用 endpoint, 不应直接 PATCH. */
  @Patch(':id')
  @AgentOnly()
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/pause')
  async pause(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.pause(id);
  }

  @Post(':id/resume')
  async resume(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.resume(id);
  }

  @Post(':id/retry')
  async retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.retry(id);
  }

  /** 重新激活父级编排任务：failed → running，让子任务按原计划继续 */
  @Post(':id/reactivate')
  async reactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.reactivate(id);
  }

  /** 强制停止：无论当前状态都标 failed + errorMsg='Cancelled by user'. */
  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.cancel(id);
  }

  /** 紧急按钮：一键取消所有 pending/running/paused 任务（按当前用户 tenant 范围）。 */
  @Post('cancel-all')
  cancelAll(@CurrentUser() user: AuthUser) {
    return this.service.cancelAll(effectiveTenantId(user));
  }

  /** 复用任务：clone 一份立即排队执行，原任务不动。 */
  @Post(':id/run-now')
  async runNow(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.cloneAndRunNow(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.service.findOneScoped(id, callerTenantId(user));
    return this.service.remove(id);
  }
}
