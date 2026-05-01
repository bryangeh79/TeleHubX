import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { CustomerGroupsService } from './customer-groups.service';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';

@Controller('customer-groups')
export class CustomerGroupsController {
  constructor(private readonly service: CustomerGroupsService) {}

  @Post()
  create(@Body() dto: CreateCustomerGroupDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerGroupDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
