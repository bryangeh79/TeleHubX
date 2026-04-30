import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { TenantPlan } from '../tenants/tenant.entity';
import { LicensesService } from './licenses.service';

@Controller('licenses')
export class LicensesController {
  constructor(private readonly service: LicensesService) {}

  /** Admin-only in production — exposed for dev-time license generation. */
  @Post('issue')
  issue(@Body() body: { plan?: TenantPlan; notes?: string }) {
    return this.service.issue(body.plan ?? TenantPlan.BASIC, body.notes);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Public()
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @Body() body: { key: string; machineId?: string; tenantName?: string },
  ) {
    return this.service.activate(body.key, body.machineId, body.tenantName);
  }

  @Get('status')
  status() {
    return this.service.status();
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.revoke(id);
  }
}
