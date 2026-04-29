import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { Account, AccountRole, AccountStatus } from './account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CsvAccountRow, ImportResult } from './dto/import-accounts.dto';
import { deriveKey, encryptSession, decryptSession } from '../crypto/session-crypto.util';

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
export class AccountsService {
  private readonly encKey: Buffer | null;

  constructor(
    @InjectRepository(Account)
    private readonly repo: Repository<Account>,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('SESSION_ENCRYPTION_KEY');
    this.encKey = raw ? deriveKey(raw) : null;
  }

  create(dto: CreateAccountDto): Promise<Account> {
    const account = this.repo.create(dto);
    return this.repo.save(account);
  }

  findAll(filters: { role?: AccountRole; status?: AccountStatus }): Promise<Account[]> {
    const where: Partial<Pick<Account, 'role' | 'status'>> = {};
    if (filters.role) where.role = filters.role;
    if (filters.status) where.status = filters.status;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Account> {
    const account = await this.repo.findOneBy({ id });
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  async update(id: string, dto: UpdateAccountDto): Promise<Account> {
    const account = await this.findOne(id);
    Object.assign(account, dto);
    return this.repo.save(account);
  }

  async remove(id: string): Promise<void> {
    const account = await this.findOne(id);
    await this.repo.remove(account);
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

  async importFromCsv(input: Buffer | any[]): Promise<ImportResult> {
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

        const account = this.repo.create({ phoneNumber: row.phoneNumber, role, proxyConfig });
        await this.repo.save(account);
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

