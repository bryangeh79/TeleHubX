import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { TenantTestGroup, TestGroupSource, TestGroupKind } from './tenant-test-group.entity';

@Injectable()
export class TenantTestGroupsService {
  constructor(@InjectRepository(TenantTestGroup) private readonly repo: Repository<TenantTestGroup>) {}

  async create(dto: {
    tenantId: string;
    source: TestGroupSource;
    tgChatId: string;
    title: string;
    kind?: TestGroupKind;
    username?: string;
    ownerAccountId?: string;
    executionGroupId?: string;
    notes?: string;
    systemMemberAccountIds?: string[];
  }): Promise<TenantTestGroup> {
    if (!dto.tenantId || !dto.tgChatId || !dto.title) {
      throw new BadRequestException('tenantId, tgChatId, title 必填');
    }
    const g = this.repo.create({
      tenantId: dto.tenantId,
      source: dto.source,
      tgChatId: dto.tgChatId,
      title: dto.title,
      kind: dto.kind ?? TestGroupKind.SMALL,
      username: dto.username,
      ownerAccountId: dto.ownerAccountId,
      executionGroupId: dto.executionGroupId,
      notes: dto.notes,
      systemMemberAccountIds: dto.systemMemberAccountIds ?? [],
    });
    return this.repo.save(g);
  }

  list(filters: { tenantId?: string; executionGroupId?: string; source?: TestGroupSource } = {}): Promise<TenantTestGroup[]> {
    const where: FindOptionsWhere<TenantTestGroup> = {};
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.executionGroupId) where.executionGroupId = filters.executionGroupId;
    if (filters.source) where.source = filters.source;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<TenantTestGroup> {
    const g = await this.repo.findOneBy({ id });
    if (!g) throw new NotFoundException(`Group ${id} not found`);
    return g;
  }

  async update(id: string, dto: Partial<TenantTestGroup>): Promise<TenantTestGroup> {
    const g = await this.findOne(id);
    Object.assign(g, dto);
    return this.repo.save(g);
  }

  async remove(id: string): Promise<void> {
    const g = await this.findOne(id);
    await this.repo.remove(g);
  }
}
