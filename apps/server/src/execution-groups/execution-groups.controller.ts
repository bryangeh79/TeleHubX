import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AssignMembersDto,
  AssignSingleAccountDto,
  SetGroupCountDto,
  UpdateGroupDto,
} from './execution-group.dto';
import { ExecutionGroupsService } from './execution-groups.service';

@Controller('execution-groups')
export class ExecutionGroupsController {
  constructor(private readonly service: ExecutionGroupsService) {}

  @Get()
  list(@Query('tenantId') tenantId?: string) {
    return this.service.listWithMembers(tenantId);
  }

  @Get('ungrouped')
  listUngrouped(@Query('tenantId') tenantId?: string) {
    return this.service.listUngrouped(tenantId);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/members')
  assignMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignMembersDto,
  ) {
    return this.service.assignMembers(id, dto);
  }

  @Post('accounts/:accountId/assign')
  assignAccount(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: AssignSingleAccountDto,
  ) {
    return this.service.assignSingleAccount(accountId, dto.groupId ?? null);
  }

  @Post('reconcile')
  reconcile(@Body() dto: SetGroupCountDto, @Query('tenantId') tenantId?: string) {
    return this.service.reconcileCount(dto.count, tenantId);
  }

  @Post('auto-schedule')
  autoSchedule(@Query('tenantId') tenantId?: string) {
    return this.service.autoSchedule(tenantId ?? null);
  }
}
