import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { LeadIntent, LeadStatus, LeadTakeover } from './lead.entity';
import { LeadsService } from './leads.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { callerTenantId, resolveTenantIdSoft } from '../auth/tenant-resolver';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ReplyLeadDto } from './dto/reply-lead.dto';

@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: LeadStatus,
    @Query('intent') intent?: LeadIntent,
    @Query('needsHuman') needsHuman?: string,
    @Query('tenantId') tid?: string,
  ) {
    return this.service.findAll({
      status,
      intent,
      needsHuman: needsHuman !== undefined ? needsHuman === 'true' : undefined,
      tenantId: resolveTenantIdSoft(user, tid),
    });
  }

  @Get('dashboard-stats')
  dashboardStats(@CurrentUser() user: AuthUser, @Query('tenantId') tid?: string) {
    return this.service.dashboardStats(resolveTenantIdSoft(user, tid) ?? undefined);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneScoped(id, callerTenantId(user));
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignLeadDto) {
    return this.service.assign(id, dto, callerTenantId(user));
  }

  @Post(':id/note')
  @HttpCode(HttpStatus.OK)
  addNote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('note') note: string) {
    return this.service.addNote(id, note, callerTenantId(user));
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  reply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyLeadDto) {
    return this.service.reply(id, dto.text, callerTenantId(user));
  }

  @Post(':id/take')
  @HttpCode(HttpStatus.OK)
  takeOver(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('operator') operator?: string,
  ) {
    return this.service.takeOver(id, operator, callerTenantId(user));
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.release(id, callerTenantId(user));
  }

  @Post(':id/state')
  @HttpCode(HttpStatus.OK)
  setState(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('state') state: LeadTakeover,
  ) {
    return this.service.setTakeoverState(id, state, callerTenantId(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id, callerTenantId(user));
  }
}
