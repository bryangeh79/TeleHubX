import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { GreetingTemplatesService } from './greeting-templates.service';
import { CreateGreetingTemplateDto } from './dto/create-greeting-template.dto';
import { UpdateGreetingTemplateDto } from './dto/update-greeting-template.dto';

@Controller('greeting-templates')
export class GreetingTemplatesController {
  constructor(private readonly service: GreetingTemplatesService) {}

  @Post()
  create(@Body() dto: CreateGreetingTemplateDto) { return this.service.create(dto); }

  @Get()
  findAll(@Query('tenantId') tenantId?: string) { return this.service.findAll(tenantId); }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.service.findOne(id); }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGreetingTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.service.remove(id); }

  /** 用平台 AI key 给开场白打分 */
  @Post(':id/score')
  @HttpCode(HttpStatus.OK)
  score(@Param('id', ParseUUIDPipe) id: string) { return this.service.scoreGreeting(id); }

  /** 生成开场白变体 */
  @Post(':id/generate-variants')
  @HttpCode(HttpStatus.OK)
  generateVariants(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.generateVariants(id);
  }

  /** 一键导入 18 条默认样本（6 类各 3 条） */
  @Post('seed-defaults')
  @HttpCode(HttpStatus.OK)
  seedDefaults(@Query('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.service.seedDefaults(tenantId);
  }
}
