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
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { TaskStatus, TaskType } from './task.entity';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('status') status?: TaskStatus,
    @Query('type') type?: TaskType,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.findAll({ status, type, tenantId });
  }

  @Get('stats')
  stats(@Query('tenantId') tenantId?: string) {
    return this.service.stats(tenantId);
  }

  /**
   * Agent 调度：领一批可执行任务（POST 因为有副作用：marks running）。
   * 请求 body: { accountIds: string[], limit?: number }
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
