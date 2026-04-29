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
import { CreateProxyDto } from './dto/create-proxy.dto';
import { UpdateProxyDto } from './dto/update-proxy.dto';
import { ProxyStatus } from './proxy.entity';
import { ProxiesService } from './proxies.service';

@Controller('proxies')
export class ProxiesController {
  constructor(private readonly service: ProxiesService) {}

  @Post()
  create(@Body() dto: CreateProxyDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('status') status?: ProxyStatus) {
    return this.service.findAll({ status });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProxyDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
