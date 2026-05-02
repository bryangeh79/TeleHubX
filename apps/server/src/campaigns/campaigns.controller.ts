import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { CampaignStatus, PacePreset } from './campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly service: CampaignsService,
    private readonly dispatch: CampaignDispatchService,
  ) {}

  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('status') status?: CampaignStatus) {
    return this.service.findAll(status);
  }

  /** 预览调度计划（dry-run，不落库） */
  @Post('dispatch-preview')
  @HttpCode(HttpStatus.OK)
  dispatchPreview(@Body() dto: {
    customerGroupIds?: string[];
    targets?: string[];
    pacePreset?: string;
    accountSourceMode?: string;
    adAccountIds?: string[];
  }) {
    return this.dispatch.preview(dto);
  }

  @Get('capacity-check')
  capacityCheck(
    @Query('targetCount') targetCount?: string,
    @Query('pacePreset') pacePreset?: PacePreset,
    @Query('customerGroupIds') customerGroupIds?: string,
    @Query('extraTargets') extraTargets?: string,
  ) {
    return this.service.capacityCheck({
      targetCount: targetCount ? parseInt(targetCount, 10) : 0,
      pacePreset,
      customerGroupIds: customerGroupIds ? customerGroupIds.split(',').filter(Boolean) : [],
      extraTargets: extraTargets ? extraTargets.split(',').filter(Boolean) : [],
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** 列出 campaign 派发出来的所有子任务（执行日志） */
  @Get(':id/tasks')
  listTasks(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listTasks(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  /** 启动投放 — 真正调度 */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async send(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.dispatch.dispatch(id);
    return {
      queued: true,
      targets: result.targetCount,
      tasksCreated: result.tasksCreated,
      days: result.days,
      accountsUsed: result.accountsUsed,
    };
  }

  /** Agent 回写：单条发送完成 +1 */
  @Post(':id/sent')
  @HttpCode(HttpStatus.OK)
  incrementSent(@Param('id', ParseUUIDPipe) id: string, @Body() body?: { delta?: number }) {
    return this.service.incrementSent(id, body?.delta ?? 1);
  }

  /** 客户回复 +1 */
  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  incrementReply(@Param('id', ParseUUIDPipe) id: string, @Body() body?: { delta?: number }) {
    return this.service.incrementReply(id, body?.delta ?? 1);
  }
}
