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
import { AllowAgent } from '../auth/roles.decorator';
import { callerTenantId, resolveTenantIdSoft } from '../auth/tenant-resolver';
import { BindOrchestratorService } from './bind/bind.service';
import { BindInitDto } from './bind/dto/bind-init.dto';
import { BindVerifyDto } from './bind/dto/bind-verify.dto';
import { CreateAccountDto } from './dto/create-account.dto';
import { ReportHealthDto } from './dto/report-health.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { WarmupService } from './warmup/warmup.service';
import { TasksService } from '../tasks/tasks.service';
import { TaskType } from '../tasks/task.entity';

@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly service: AccountsService,
    private readonly warmupService: WarmupService,
    private readonly bindService: BindOrchestratorService,
    private readonly tasksService: TasksService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.service.create(dto, resolveTenantIdSoft(user));
  }

  @Get()
  @AllowAgent()
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
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOneScoped(id, callerTenantId(user));
  }

  @Patch(':id')
  @AllowAgent()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.service.update(id, dto, callerTenantId(user));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id, callerTenantId(user));
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
  @AllowAgent()
  @HttpCode(HttpStatus.OK)
  heartbeat(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.heartbeat(id);
  }

  /**
   * 租户主动请求重置该账号 GramJS 连接。
   * 用于 wedged client 自助修复：销毁旧实例 + 用同 session 重建，约 30s 内 agent 执行。
   */
  @Post(':id/reset-connection')
  @HttpCode(HttpStatus.OK)
  async resetConnection(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const acct = await this.service.requestReset(id, callerTenantId(user));
    return { ok: true, requestedAt: acct.resetRequestedAt };
  }

  @Post('import')
  importAccounts(@CurrentUser() user: AuthUser, @Body() body: { accounts: any[] }) {
    return this.service.importFromCsv(body.accounts, callerTenantId(user));
  }

  /**
   * vmfix26 #14: 启动养号 = 同时做两件事，让用户「点了启动 → 真在跑」符合直觉：
   *   1. 创建 WarmupPlan (phase 追踪器，养号页进度条数据源)
   *   2. 自动创建 PRESET_WARMUP_7D 任务，server 端 expandPreset 展开成 10+ 子任务
   *      (IDLE_KEEPALIVE / BROWSE_CHANNEL / JOIN_CHANNELS / REACTION_BOOST / ...)，
   *      agent 按 scheduledAt 逐个领取真跑
   *
   * 老行为 (vmfix25 及以前) 只做 (1)，phase 追踪器看着在动，实际 agent 啥也没做。
   * 测试机 7 个号 phase=P1/P2 但 tasks 表 0 个 preset_*，就是这个 bug 的现场。
   *
   * 如果 task 创建失败（如 license 限制 / 名字冲突）→ 不阻塞 phase 创建，
   * 但 response 里返 warning 让前端能提示用户去任务调度手动建。
   */
  @Post(':id/warmup/start')
  async warmupStart(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const plan = await this.warmupService.start(id);
    let presetTask: { id: string } | null = null;
    let presetWarning: string | null = null;
    try {
      const acc = await this.service.findOne(id);
      const task = await this.tasksService.create(
        {
          name: `养号 7 天 · ${acc.phoneNumber}`,
          type: TaskType.PRESET_WARMUP_7D,
          accountId: id,
          accountLabel: acc.phoneNumber,
          scheduledAt: new Date().toISOString(),
          payload: {},
        } as any,
        resolveTenantIdSoft(user) ?? undefined,
      );
      presetTask = { id: task.id };
    } catch (err: unknown) {
      presetWarning = `自动创建养号任务失败: ${err instanceof Error ? err.message : String(err)}. 请到「任务调度」手动创建 preset_warmup_7d 任务.`;
    }
    return { plan, presetTask, presetWarning };
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

  /** 仅 agent 用于 boot 时拉账号 session 上线 — 普通用户不能拉解密 session */
  @Get(':id/session/raw')
  @AllowAgent()
  getDecryptedSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getDecryptedSessionScoped(id, callerTenantId(user)).then((session) => ({ session }));
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
