import {
  BadRequestException,
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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from '../auth/roles.decorator';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { UserRole } from '../auth/user.entity';
import { LicensesService } from '../licenses/licenses.service';
import { Account } from '../accounts/account.entity';
import { TenantPlan } from '../tenants/tenant.entity';
import { TenantsService } from '../tenants/tenants.service';
import { CreateUserDto, UpdateUserDto, UsersService } from './users.service';

/**
 * SaaS 平台管理后台接口。所有端点要求 SUPER_ADMIN 角色。
 * 由 RolesGuard (APP_GUARD) 强制校验。
 */
@Controller('admin')
@Roles(UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly licenses: LicensesService,
    private readonly usersService: UsersService,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
  ) {}

  // ── Tenants ────────────────────────────────────────────────────────

  @Get('tenants')
  async listTenants() {
    const all = await this.tenants.findAll();
    // 加每个 tenant 的账号数（前端表格用）
    const accountCounts = await this.accountRepo
      .createQueryBuilder('a')
      .select('a.tenantId', 'tenantId')
      .addSelect('COUNT(*)', 'count')
      .where('a.tenantId IS NOT NULL')
      .groupBy('a.tenantId')
      .getRawMany();
    const countMap = new Map(accountCounts.map(r => [r.tenantId, parseInt(r.count, 10)]));
    return all.map(t => ({
      ...t,
      currentAccounts: countMap.get(t.id) ?? 0,
    }));
  }

  @Post('tenants')
  async createTenant(@Body() body: { name: string; plan?: TenantPlan }) {
    if (!body?.name?.trim()) throw new BadRequestException('name 必填');
    const plan = body.plan ?? TenantPlan.BASIC;
    return this.tenants.create(body.name.trim(), plan);
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: string; plan?: TenantPlan; maxAccounts?: number },
  ) {
    return this.tenants.update(id, body);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspendTenant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.tenants.suspend(id, body?.reason);
  }

  @Post('tenants/:id/resume')
  @HttpCode(HttpStatus.OK)
  resumeTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.resume(id);
  }

  @Delete('tenants/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.remove(id);
  }

  // ── Licenses ────────────────────────────────────────────────────────

  @Get('licenses')
  listLicenses(@Query('tenantId') tenantId?: string) {
    return tenantId ? this.licenses.findByTenant(tenantId) : this.licenses.findAll();
  }

  /** 签发新 license。可选直接绑到 tenantId（跳过 /activate 自助流程） */
  @Post('licenses/issue')
  async issueLicense(@Body() body: {
    plan?: TenantPlan;
    notes?: string;
    tenantId?: string;
    bindNow?: boolean;
  }) {
    const plan = body.plan ?? TenantPlan.BASIC;
    const license = await this.licenses.issue(plan, body.notes);
    if (body.bindNow && body.tenantId) {
      // 直接调 tenants.setLicense 绑定（管理员主动行为，跳过 activate 自助校验）
      await this.tenants.setLicense(body.tenantId, license.key, plan, license.expiresAt);
    }
    return license;
  }

  @Post('licenses/:id/revoke')
  @HttpCode(HttpStatus.OK)
  revokeLicense(@Param('id', ParseUUIDPipe) id: string) {
    return this.licenses.revoke(id);
  }

  // ── Users ────────────────────────────────────────────────────────────

  @Get('users')
  listUsers(@Query('tenantId') tenantId?: string) {
    return this.usersService.list(tenantId);
  }

  @Post('users')
  createUser(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.usersService.update(id, body);
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.resetPassword(id);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.usersService.remove(id, caller.sub);
  }

  // ── Stats ────────────────────────────────────────────────────────────

  @Get('stats')
  async stats() {
    const tenants = await this.tenants.findAll();
    const licenses = await this.licenses.findAll();
    const now = Date.now();
    const expiringIn30d = licenses.filter(l => {
      if (!l.expiresAt) return false;
      const ms = new Date(l.expiresAt).getTime() - now;
      return ms > 0 && ms < 30 * 86400_000;
    }).length;
    return {
      totalTenants: tenants.length,
      activeTenants: tenants.filter(t => t.status === 'active').length,
      suspendedTenants: tenants.filter(t => t.status === 'suspended').length,
      totalLicenses: licenses.length,
      activeLicenses: licenses.filter(l => l.status === 'active').length,
      expiringIn30d,
    };
  }
}
