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
import { TestGroupSource } from './tenant-test-group.entity';
import { TenantTestGroupsService } from './tenant-test-groups.service';
import { TenantsService } from '../tenants/tenants.service';

@Controller('test-groups')
export class TenantTestGroupsController {
  constructor(
    private readonly service: TenantTestGroupsService,
    private readonly tenants: TenantsService,
  ) {}

  private async resolveTenantId(tenantId?: string): Promise<string> {
    if (tenantId) return tenantId;
    return (await this.tenants.getDefault()).id;
  }

  @Post()
  async create(@Body() body: any) {
    const tenantId = await this.resolveTenantId(body.tenantId);
    return this.service.create({ ...body, tenantId });
  }

  @Get()
  async list(
    @Query('source') source?: TestGroupSource,
    @Query('executionGroupId') executionGroupId?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const tid = await this.resolveTenantId(tenantId);
    return this.service.list({ tenantId: tid, source, executionGroupId });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
