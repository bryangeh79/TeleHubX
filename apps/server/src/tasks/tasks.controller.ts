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
  dispatch(@Body() body: { accountIds: string[]; limit?: number }) {
    return this.service.dispatchToAgent(body.accountIds ?? [], body.limit);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/pause')
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.pause(id);
  }

  @Post(':id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.resume(id);
  }

  @Post(':id/retry')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.retry(id);
  }

  /** 强制停止：无论当前状态都标 failed + errorMsg='Cancelled by user'. */
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(id);
  }

  /** 复用任务：clone 一份立即排队执行，原任务不动。 */
  @Post(':id/run-now')
  runNow(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cloneAndRunNow(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
