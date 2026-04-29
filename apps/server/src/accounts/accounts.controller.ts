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
import { AccountRole, AccountStatus } from './account.entity';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { ReportHealthDto } from './dto/report-health.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateSessionDto } from './dto/update-session.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  create(@Body() dto: CreateAccountDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('role') role?: AccountRole,
    @Query('status') status?: AccountStatus,
  ) {
    return this.service.findAll({ role, status });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post(':id/session')
  updateSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.service.updateSession(id, dto.sessionString);
  }

  @Post(':id/health')
  reportHealth(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportHealthDto,
  ) {
    return this.service.reportHealth(id, dto.healthScore, dto.note);
  }

  @Post(':id/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.heartbeat(id);
  }
}
