import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountRole, AccountStatus } from './account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly repo: Repository<Account>,
  ) {}

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
    await this.repo.update(id, { sessionString });
    return { ok: true };
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

  private deriveStatus(current: AccountStatus, score: number): AccountStatus {
    if (current === AccountStatus.BANNED) return AccountStatus.BANNED;
    if (score < 30) return AccountStatus.ERROR;
    return current;
  }
}
