import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { UpdateTenantSettingsDto } from './tenant-settings.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('default')
  getDefault() {
    return this.service.getDefault();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/settings')
  getSettings(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getSettings(id);
  }

  @Patch(':id/settings')
  updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantSettingsDto,
  ) {
    return this.service.updateSettings(id, dto);
  }
}
