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
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { resolveTenantIdSoft } from '../auth/tenant-resolver';
import { BindOrchestratorService } from './bind/bind.service';
import { BindInitDto } from './bind/dto/bind-init.dto';
import { BindVerifyDto } from './bind/dto/bind-verify.dto';
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
    private readonly bindService: BindOrchestratorService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.service.create(dto, resolveTenantIdSoft(user));
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('role') role?: AccountRole,
    @Query('status') status?: AccountStatus,
    @Query('tenantId') queryTid?: string,
  ) {
    // SUPER_ADMIN 可显式传 tenantId 跨租户查；普通用户强制用自己 tenantId；
    // agent 不传 tenantId 时返回全量（agent 进程跨租户）
    const tenantId = resolveTenantIdSoft(user, queryTid);
    return this.service.findAll({ role, status, tenantId: tenantId ?? undefined });
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

  // === BindWizard endpoints ===

  @Post(':id/bind/init')
  @HttpCode(HttpStatus.OK)
  bindInit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BindInitDto,
  ) {
    return this.bindService.init(id, dto.phone);
  }

  @Post(':id/bind/verify')
  @HttpCode(HttpStatus.OK)
  bindVerify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BindVerifyDto,
  ) {
    return this.bindService.verify(id, dto.code, dto.password);
  }

  @Post(':id/bind/cancel')
  @HttpCode(HttpStatus.OK)
  bindCancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.bindService.cancel(id);
  }
}
