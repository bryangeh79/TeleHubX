import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { AdTemplatesService } from './ad-templates.service';
import { CreateAdTemplateDto } from './dto/create-ad-template.dto';
import { UpdateAdTemplateDto } from './dto/update-ad-template.dto';

@Controller('ad-templates')
export class AdTemplatesController {
  constructor(private readonly service: AdTemplatesService) {}

  @Post()
  create(@Body() dto: CreateAdTemplateDto) { return this.service.create(dto); }

  @Get()
  findAll(@Query('tenantId') tenantId?: string) { return this.service.findAll(tenantId); }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.service.findOne(id); }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.service.remove(id); }
}
