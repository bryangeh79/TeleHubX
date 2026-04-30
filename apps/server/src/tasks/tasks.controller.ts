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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
