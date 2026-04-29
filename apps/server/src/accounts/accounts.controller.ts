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
import { WarmupService } from './warmup/warmup.service';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly service: AccountsService,
    private readonly warmupService: WarmupService,
  ) {}

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

  @Get('health-stats')
  getHealthStats() {
    return this.service.getHealthStats();
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
    return this.service.reportHealth(id, dto.healthScore, dto.remark || dto.note);
  }

  @Post(':id/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.heartbeat(id);
  }

  @Post('import')
  importAccounts(@Body() body: { accounts: any[] }) {
    return this.service.importFromCsv(body.accounts);
  }

  @Post(':id/warmup/start')
  warmupStart(@Param('id', ParseUUIDPipe) id: string) {
    return this.warmupService.start(id);
  }

  @Post(':id/warmup/advance')
  @HttpCode(HttpStatus.OK)
  warmupAdvance(@Param('id', ParseUUIDPipe) id: string) {
    return this.warmupService.advance(id);
  }

  @Get(':id/warmup')
  warmupStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.warmupService.getStatus(id);
  }

  @Post(':id/warmup/pause')
  @HttpCode(HttpStatus.OK)
  warmupPause(@Param('id', ParseUUIDPipe) id: string) {
    return this.warmupService.pause(id);
  }

  @Post(':id/warmup/resume')
  @HttpCode(HttpStatus.OK)
  warmupResume(@Param('id', ParseUUIDPipe) id: string) {
    return this.warmupService.resume(id);
  }

  @Post(':id/bind-ip')
  @HttpCode(HttpStatus.OK)
  bindIp(@Param('id', ParseUUIDPipe) id: string, @Body('ip') ip: string) {
    return this.service.bindIp(id, ip);
  }

  @Get(':id/session/raw')
  getDecryptedSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getDecryptedSession(id).then((session) => ({ session }));
  }
}
