import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { CampaignStatus, PacePreset } from './campaign.entity';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('status') status?: CampaignStatus) {
    return this.service.findAll(status);
  }

  /** 承载力计算 — 向导第 3 步实时调用 */
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

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.send(id);
  }
}
