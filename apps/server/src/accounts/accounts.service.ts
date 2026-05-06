import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { Account, AccountRole, AccountStatus } from './account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CsvAccountRow, ImportResult } from './dto/import-accounts.dto';
import { deriveKey, encryptSession, decryptSession } from '../crypto/session-crypto.util';
import { generateDeviceFingerprint } from './device-fingerprint.util';
import { SlotsService } from '../slots/slots.service';
import { TenantsService } from '../tenants/tenants.service';
import { ensureTenant } from '../auth/tenant-guard.util';
import { CloudLicenseService } from '../cloud-license/cloud-license.service';

export interface HealthStats {
  total: number;
  healthy: number;
  warning: number;
  caution: number;
  critical: number;
  avgHealthScore: number;
  byStatus: Record<string, number>;
}

@Injectable()
export class AccountsService implements OnModuleInit {
  private readonly logger = new Logger(AccountsService.name);
  private readonly encKey: Buffer | null;

  constructor(
    @InjectRepository(Account)
    private readonly repo: Repository<Account>,
    private readonly config: ConfigService,
    private readonly slots: SlotsService,
    private readonly tenants: TenantsService,
    private readonly cloudLicense: CloudLicenseService,
  ) {
    const raw = this.config.get<string>('SESSION_ENCRYPTION_KEY');
    this.encKey = raw ? deriveKey(raw) : null;
  }

  /** SaaS 多租户：把所有 tenantId=null 的旧账号绑到 default tenant，让老数据无缝进入隔离体系。 */
  async onModuleInit(): Promise<void> {
    const orphans = await this.repo.count({ where: { tenantId: IsNull() } });
    if (orphans > 0) {
      const defaultTenant = await this.tenants.getDefault().catch(() => null);
      if (defaultTenant?.id) {
        const r = await this.backfillTenantIds(defaultTenant.id);
        this.logger.log(`backfilled ${r.updated} legacy accounts to default tenant=${defaultTenant.id.slice(0, 8)}`);
      } else {
        this.logger.warn(`${orphans} accounts have no tenantId but no default tenant exists`);
      }
    }
  }

  async create(dto: CreateAccountDto, tenantId?: string | null): Promise<Account> {
    // Cloud-license gate: enforce maxAccounts + locked-down status before insert.
    const gate = await this.cloudLicense.canAddAccount();
    if (!gate.ok) throw new ForbiddenException(gate.reason ?? 'License does not allow new accounts');

    const account = this.repo.create({ ...dto, tenantId: tenantId ?? null });
    const saved = await this.repo.save(account);
    // Generate unique device fingerprint NOW, derived from the saved id.
    // 不能延后到 bind 时刻 — bind 失败重试时 id 不变指纹必须稳定。
    if (!saved.deviceFingerprint) {
      const fp = generateDeviceFingerprint(saved.id);
      saved.deviceFingerprint = fp as any;
      await this.repo.update(saved.id, { deviceFingerprint: fp as any });
    }
    // Assign a slot (lowest VACANT, or new at max+1) so the tenant gets a stable No.
    await this.slots.assignToAccount(saved.id);
    return saved;
  }

  /** Internal: ensure account has a fingerprint (lazy-init for legacy rows). */
  async ensureDeviceFingerprint(id: string): Promise<Record<string, string>> {
    const account = await this.findOne(id);
    if (account.deviceFingerprint) return account.deviceFingerprint;
    const fp = generateDeviceFingerprint(id) as any;
    await this.repo.update(id, { deviceFingerprint: fp });
    return fp;
  }

  findAll(filters: { role?: AccountRole; status?: AccountStatus; tenantId?: string | null }): Promise<Account[]> {
    const where: any = {};
    if (filters.role) where.role = filters.role;
    if (filters.status) where.status = filters.status;
    if (filters.tenantId === null) where.tenantId = IsNull();
    else if (filters.tenantId !== undefined) where.tenantId = filters.tenantId;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  /**
   * 启动时回填：把所有 tenantId=null 的旧账号绑到 default tenant。
   * 让单租户老数据无缝进入多租户世界。
   */
  async backfillTenantIds(defaultTenantId: string): Promise<{ updated: number }> {
    const r = await this.repo
      .createQueryBuilder()
      .update()
      .set({ tenantId: defaultTenantId })
      .where('"tenantId" IS NULL')
      .execute();
    return { updated: r.affected ?? 0 };
  }

  /**
   * 内部方法（不做租户权属校验）。仅给 agent / super-admin / cross-tenant 内部调用。
   * 普通端点应使用 findOneScoped。
   */
  async findOne(id: string): Promise<Account> {
    const account = await this.repo.findOneBy({ id });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  /** 租户权属保护版：callerTenantId=null 表示 super_admin/agent 直通 */
  async findOneScoped(id: string, callerTenantId: string | null): Promise<Account> {
    const account = await this.repo.findOneBy({ id });
    return ensureTenant(account, callerTenantId, 'Account');
  }

  async update(id: string, dto: UpdateAccountDto, callerTenantId: string | null = null): Promise<Account> {
    const account = await this.findOneScoped(id, callerTenantId);
    Object.assign(account, dto);
    await this.repo.save(account);
    return this.findOne(id);
  }

  /**
   * 租户主动请求重置该账号的 GramJS 客户端实例。
   * 只设置 resetRequestedAt 时间戳；agent 在 syncFromDb 轮询时看到
   * resetRequestedAt > slot.connectedAt 触发 reconnectAccount。
   * 不重新 auth、不重写 sessionString —— 仅销毁旧 client + 用同 session 新建。
   */
  async requestReset(id: string, callerTenantId: string | null = null): Promise<Account> {
    const account = await this.findOneScoped(id, callerTenantId);
    account.resetRequestedAt = new Date();
    await this.repo.save(account);
    this.logger.log(`[reset] account ${id.slice(0, 8)} reset requested (tenant=${callerTenantId ?? 'super_admin'})`);
    return account;
  }

  async remove(id: string, callerTenantId: string | null = null): Promise<void> {
    const account = await this.findOneScoped(id, callerTenantId);
    await this.slots.releaseFromAccount(id);
    await this.repo.remove(account);
  }

  /** 解密 session — 仅 agent 调用。普通用户/admin 不应能拿。 */
  async getDecryptedSessionScoped(id: string, callerTenantId: string | null): Promise<string> {
    const account = await this.repo.findOne({ where: { id }, select: ['id', 'tenantId', 'sessionString', 'sessionEncrypted'] });
    ensureTenant(account, callerTenantId, 'Account');
    return this.getDecryptedSession(id);
  }

  async updateSession(id: string, sessionString: string): Promise<{ ok: boolean }> {
    await this.findOne(id);
    let stored = sessionString;
    let encrypted = false;
    if (this.encKey) {
      stored = encryptSession(sessionString, this.encKey);
      encrypted = true;
    }
    await this.repo.update(id, { sessionString: stored, sessionEncrypted: encrypted });
    return { ok: true };
  }

  async getDecryptedSession(id: string): Promise<string> {
    const account = await this.repo.findOne({ where: { id }, select: ['id', 'sessionString', 'sessionEncrypted'] });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    if (!account.sessionString) return '';
    if (account.sessionEncrypted && this.encKey) {
      return decryptSession(account.sessionString, this.encKey);
    }
    return account.sessionString;
  }

  async bindIp(id: string, ip: string): Promise<Account> {
    const account = await this.findOne(id);
    account.boundIp = ip;
    return this.repo.save(account);
  }

  async reportHealth(id: string, healthScore: number, note?: string): Promise<Account> {
    const account = await this.findOne(id);
    account.healthScore = healthScore;
    account.status = this.deriveStatus(account.status, healthScore);
    return this.repo.save(account);
  }

  async heartbeat(id: string): Promise<{ ok: boolean; lastActiveAt: Date }> {
    const now = new Date();
    await this.findOne(id);
    await this.repo.update(id, { lastActiveAt: now, status: AccountStatus.ONLINE });
    return { ok: true, lastActiveAt: now };
  }

  async importFromCsv(input: Buffer | any[], callerTenantId?: string | null): Promise<ImportResult> {
    let rows: CsvAccountRow[];
    if (Array.isArray(input)) {
      rows = input.map((a: any, i: number) => ({
        phoneNumber: a.phoneNumber || a.phone,
        role: a.role,
        proxyHost: a.proxyHost || a.proxy?.host,
        proxyPort: String(a.proxyPort || a.proxy?.port || ''),
        proxyUsername: a.proxyUsername || a.proxy?.username,
        proxyPassword: a.proxyPassword || a.proxy?.password,
      }));
    } else {
      rows = parse(input, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    }

    const result: ImportResult = { total: rows.length, created: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.phoneNumber) {
        result.errors.push({ row: i + 2, phone: '', reason: 'Missing phoneNumber' });
        continue;
      }

      const existing = await this.repo.findOneBy({ phoneNumber: row.phoneNumber });
      if (existing) {
        result.skipped++;
        continue;
      }

      // Per-row license gate so we stop importing as soon as quota is hit.
      const gate = await this.cloudLicense.canAddAccount();
      if (!gate.ok) {
        result.errors.push({ row: i + 2, phone: row.phoneNumber, reason: gate.reason ?? 'license_blocked' });
        continue;
      }

      try {
        const role = Object.values(AccountRole).includes(row.role as AccountRole)
          ? (row.role as AccountRole)
          : AccountRole.CS;

        const proxyConfig =
          row.proxyHost && row.proxyPort
            ? {
                host: row.proxyHost,
                port: parseInt(row.proxyPort, 10),
                username: row.proxyUsername,
                password: row.proxyPassword,
              }
            : undefined;

        const account = this.repo.create({
          phoneNumber: row.phoneNumber,
          role,
          proxyConfig,
          ...(callerTenantId ? { tenantId: callerTenantId } : {}),
        });
        const saved = await this.repo.save(account);
        await this.slots.assignToAccount(saved.id);
        result.created++;
      } catch (err: any) {
        result.errors.push({ row: i + 2, phone: row.phoneNumber, reason: err?.message ?? 'Unknown' });
      }
    }

    return result;
  }

  async getHealthStats(): Promise<HealthStats> {
    const accounts = await this.repo.find({ select: ['healthScore', 'status'] });

    const stats: HealthStats = {
      total: accounts.length,
      healthy: 0,
      warning: 0,
      caution: 0,
      critical: 0,
      avgHealthScore: 0,
      byStatus: {},
    };

    let sum = 0;
    for (const acc of accounts) {
      sum += acc.healthScore;
      if (acc.healthScore >= 80) stats.healthy++;
      else if (acc.healthScore >= 60) stats.warning++;
      else if (acc.healthScore >= 30) stats.caution++;
      else stats.critical++;

      stats.byStatus[acc.status] = (stats.byStatus[acc.status] || 0) + 1;
    }

    stats.avgHealthScore = accounts.length ? Math.round(sum / accounts.length) : 0;
    return stats;
  }

  private deriveStatus(current: AccountStatus, score: number): AccountStatus {
    if (current === AccountStatus.BANNED) return AccountStatus.BANNED;
    if (score < 30) return AccountStatus.ERROR;
    return current;
  }
}

