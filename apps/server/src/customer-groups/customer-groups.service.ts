import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { CustomerGroup, MemberDetail, MemberSource } from './customer-group.entity';
import { LeadCandidate } from '../leads-candidates/lead-candidate.entity';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';

/** 标准化电话号码：去空格/连字符，+ 前缀保留 */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-()]/g, '');
  if (!trimmed) return '';
  // 已带 + 的保留；纯数字则按需加 +（这里不强加，让用户输入决定）
  return trimmed;
}

/** 通用成员值规范化（号码/@username/tgUserId/链接 都接受） */
function normalizeMember(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  // 纯数字开头视为电话号
  if (/^\+?\d{6,}$/.test(t.replace(/[\s\-]/g, ''))) {
    return normalizePhone(t);
  }
  // @username 保留
  if (t.startsWith('@')) return t.toLowerCase();
  // 链接 / chat id 原样
  return t;
}

@Injectable()
export class CustomerGroupsService {
  constructor(
    @InjectRepository(CustomerGroup)
    private readonly repo: Repository<CustomerGroup>,
    @InjectRepository(LeadCandidate)
    private readonly candidateRepo: Repository<LeadCandidate>,
  ) {}

  create(dto: CreateCustomerGroupDto): Promise<CustomerGroup> {
    const rawMembers = (dto.members ?? []).map(normalizeMember).filter(Boolean);
    const seen = new Set<string>();
    const members = rawMembers.filter(m => !seen.has(m) && (seen.add(m), true));
    const now = new Date().toISOString();
    const memberDetails: MemberDetail[] = members.map(value => ({
      value,
      source: 'manual',
      addedAt: now,
    }));
    const group = this.repo.create({
      ...dto,
      members,
      memberDetails,
      memberCount: members.length,
    });
    return this.repo.save(group);
  }

  findAll(tenantId?: string): Promise<CustomerGroup[]> {
    const where = tenantId ? { tenantId } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<CustomerGroup> {
    const g = await this.repo.findOneBy({ id });
    if (!g) throw new NotFoundException(`CustomerGroup ${id} not found`);
    return g;
  }

  async update(id: string, dto: UpdateCustomerGroupDto): Promise<CustomerGroup> {
    const g = await this.findOne(id);
    if (dto.members !== undefined) {
      const rawMembers = dto.members.map(normalizeMember).filter(Boolean);
      const seen = new Set<string>();
      const members = rawMembers.filter(m => !seen.has(m) && (seen.add(m), true));
      g.members = members;
      // 重建 memberDetails — 保留已有的，新加的标 manual
      const oldMap = new Map((g.memberDetails ?? []).map(d => [d.value, d]));
      const now = new Date().toISOString();
      g.memberDetails = members.map(v => oldMap.get(v) ?? { value: v, source: 'manual' as MemberSource, addedAt: now });
      g.memberCount = members.length;
    }
    if (dto.name !== undefined) g.name = dto.name;
    if (dto.description !== undefined) g.description = dto.description;
    if (dto.tags !== undefined) g.tags = dto.tags;
    return this.repo.save(g);
  }

  async remove(id: string): Promise<void> {
    const g = await this.findOne(id);
    await this.repo.remove(g);
  }

  /** 追加成员到已有群（自动去重） */
  async appendMembers(
    id: string,
    items: Array<{ value: string; source?: MemberSource; huntTaskId?: string; tgUserId?: string; tgUsername?: string; isPremium?: boolean }>,
  ): Promise<{ group: CustomerGroup; added: number; skipped: number }> {
    const g = await this.findOne(id);
    const existingSet = new Set(g.members ?? []);
    const now = new Date().toISOString();
    const newMembers: string[] = [];
    const newDetails: MemberDetail[] = [];
    let skipped = 0;
    for (const it of items) {
      const value = normalizeMember(it.value);
      if (!value) { skipped++; continue; }
      if (existingSet.has(value)) { skipped++; continue; }
      existingSet.add(value);
      newMembers.push(value);
      newDetails.push({
        value,
        source: it.source ?? 'manual',
        addedAt: now,
        huntTaskId: it.huntTaskId,
        tgUserId: it.tgUserId,
        tgUsername: it.tgUsername,
        isPremium: it.isPremium,
      });
    }
    g.members = [...(g.members ?? []), ...newMembers];
    g.memberDetails = [...(g.memberDetails ?? []), ...newDetails];
    g.memberCount = g.members.length;
    const saved = await this.repo.save(g);
    return { group: saved, added: newMembers.length, skipped };
  }

  /** 从某个成员移除 */
  async removeMember(id: string, value: string): Promise<CustomerGroup> {
    const g = await this.findOne(id);
    const v = normalizeMember(value);
    g.members = (g.members ?? []).filter(m => m !== v);
    g.memberDetails = (g.memberDetails ?? []).filter(d => d.value !== v);
    g.memberCount = g.members.length;
    return this.repo.save(g);
  }

  /** 从候选池筛选并打包成新客户群 */
  async createFromCandidates(dto: {
    tenantId: string;
    name: string;
    description?: string;
    huntTaskId?: string;
    minPriorityScore?: number;
    onlyPremium?: boolean;
    activeWithinDays?: number;
    limit?: number;
  }): Promise<CustomerGroup> {
    const qb = this.candidateRepo.createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId: dto.tenantId });

    if (dto.huntTaskId) {
      qb.andWhere('c.huntTaskId = :huntTaskId', { huntTaskId: dto.huntTaskId });
    }
    if (typeof dto.minPriorityScore === 'number') {
      qb.andWhere('c.priorityScore >= :score', { score: dto.minPriorityScore });
    }
    if (dto.onlyPremium) {
      qb.andWhere('c.isPremium = true');
    }
    if (dto.activeWithinDays && dto.activeWithinDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - dto.activeWithinDays);
      qb.andWhere('c.lastSeenAt >= :cutoff', { cutoff });
    }

    qb.orderBy('c.priorityScore', 'DESC').addOrderBy('c.scrapedAt', 'DESC');
    if (dto.limit && dto.limit > 0) qb.take(dto.limit);

    const candidates = await qb.getMany();

    const now = new Date().toISOString();
    const seen = new Set<string>();
    const memberDetails: MemberDetail[] = [];
    for (const c of candidates) {
      // 优先用 phone（私聊更稳），没有则 @username，再没有用 tgUserId
      const value = c.phone ?? (c.tgUsername ? `@${c.tgUsername}` : c.tgUserId);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      memberDetails.push({
        value,
        source: 'lead_hunt',
        addedAt: now,
        huntTaskId: c.huntTaskId ?? undefined,
        tgUserId: c.tgUserId,
        tgUsername: c.tgUsername ?? undefined,
        isPremium: c.isPremium,
      });
    }

    const members = memberDetails.map(d => d.value);

    const group = this.repo.create({
      tenantId: dto.tenantId,
      name: dto.name,
      description: dto.description,
      sourceType: 'candidates',
      members,
      memberDetails,
      memberCount: members.length,
    });
    return this.repo.save(group);
  }

  /**
   * 从指定候选人 ID 列表打包成新客户群（前端多选 → 打包用）。
   */
  async createFromCandidateIds(dto: {
    tenantId: string;
    name: string;
    description?: string;
    candidateIds: string[];
  }): Promise<CustomerGroup> {
    if (!dto.candidateIds.length) {
      throw new NotFoundException('candidateIds 不能为空');
    }
    const candidates = await this.candidateRepo.find({
      where: { id: In(dto.candidateIds), tenantId: dto.tenantId },
    });
    const group = await this.buildGroupFromCandidates({
      tenantId: dto.tenantId,
      name: dto.name,
      description: dto.description,
      candidates,
    });
    await this.markCandidatesPacked(candidates, group.id);
    return group;
  }

  /**
   * 从 scrape 窗口建群（B 自动）：sourceGroupId + since 时间过滤本次 scrape 入库的候选人。
   * 如果 nameSuffix-相同的群已存在则 append 而非新建（防多次重跑重复建群）。
   */
  async createFromScrapeWindow(dto: {
    tenantId: string;
    name: string;
    description?: string;
    sourceGroupId: string;
    since: Date;
  }): Promise<{ group: CustomerGroup; created: boolean; addedCount: number }> {
    const candidates = await this.candidateRepo.find({
      where: {
        tenantId: dto.tenantId,
        sourceGroupId: dto.sourceGroupId,
        scrapedAt: MoreThanOrEqual(dto.since),
      },
    });
    if (!candidates.length) {
      // 0 候选人不建群（避免空群污染），调用方决定怎么处理
      return { group: null as any, created: false, addedCount: 0 };
    }
    // 同名群存在 → append 去重
    const existing = await this.repo.findOne({ where: { tenantId: dto.tenantId, name: dto.name } });
    if (existing) {
      const items = candidates.map(c => ({
        value: c.phone ?? (c.tgUsername ? `@${c.tgUsername}` : c.tgUserId),
        source: 'group_scrape' as MemberSource,
        huntTaskId: c.huntTaskId ?? undefined,
        tgUserId: c.tgUserId,
        tgUsername: c.tgUsername ?? undefined,
        isPremium: c.isPremium,
      })).filter(it => !!it.value);
      const r = await this.appendMembers(existing.id, items);
      await this.markCandidatesPacked(candidates, existing.id);
      return { group: r.group, created: false, addedCount: r.added };
    }
    const group = await this.buildGroupFromCandidates({
      tenantId: dto.tenantId,
      name: dto.name,
      description: dto.description,
      candidates,
      defaultSource: 'group_scrape',
    });
    await this.markCandidatesPacked(candidates, group.id);
    return { group, created: true, addedCount: group.memberCount };
  }

  /** 给一批候选人写入 packedIntoGroupIds（不影响已存在的其他 group id） */
  private async markCandidatesPacked(candidates: LeadCandidate[], groupId: string): Promise<void> {
    if (!candidates.length) return;
    for (const c of candidates) {
      const existing = c.packedIntoGroupIds ?? [];
      if (existing.includes(groupId)) continue;
      c.packedIntoGroupIds = [...existing, groupId];
    }
    await this.candidateRepo.save(candidates);
  }

  /** 候选人列表 → CustomerGroup 实体共享构建逻辑（不直接 save） */
  private async buildGroupFromCandidates(dto: {
    tenantId: string;
    name: string;
    description?: string;
    candidates: LeadCandidate[];
    defaultSource?: MemberSource;
  }): Promise<CustomerGroup> {
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const memberDetails: MemberDetail[] = [];
    for (const c of dto.candidates) {
      const value = c.phone ?? (c.tgUsername ? `@${c.tgUsername}` : c.tgUserId);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      memberDetails.push({
        value,
        source: dto.defaultSource ?? 'lead_hunt',
        addedAt: now,
        huntTaskId: c.huntTaskId ?? undefined,
        tgUserId: c.tgUserId,
        tgUsername: c.tgUsername ?? undefined,
        isPremium: c.isPremium,
      });
    }
    const members = memberDetails.map(d => d.value);
    const group = this.repo.create({
      tenantId: dto.tenantId,
      name: dto.name,
      description: dto.description,
      sourceType: 'candidates',
      members,
      memberDetails,
      memberCount: members.length,
    });
    return this.repo.save(group);
  }

  /** 候选池预览（不创建群，给前端看人数和示例） */
  async previewCandidates(filters: {
    tenantId: string;
    huntTaskId?: string;
    minPriorityScore?: number;
    onlyPremium?: boolean;
    activeWithinDays?: number;
  }): Promise<{ count: number; samples: Array<{ phone?: string; tgUsername?: string; tgUserId: string; isPremium: boolean; priorityScore: number }> }> {
    const qb = this.candidateRepo.createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId: filters.tenantId });
    if (filters.huntTaskId) qb.andWhere('c.huntTaskId = :huntTaskId', { huntTaskId: filters.huntTaskId });
    if (typeof filters.minPriorityScore === 'number') qb.andWhere('c.priorityScore >= :score', { score: filters.minPriorityScore });
    if (filters.onlyPremium) qb.andWhere('c.isPremium = true');
    if (filters.activeWithinDays && filters.activeWithinDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.activeWithinDays);
      qb.andWhere('c.lastSeenAt >= :cutoff', { cutoff });
    }
    const count = await qb.getCount();
    const samples = await qb.orderBy('c.priorityScore', 'DESC').take(5).getMany();
    return {
      count,
      samples: samples.map(c => ({
        phone: c.phone ?? undefined,
        tgUsername: c.tgUsername ?? undefined,
        tgUserId: c.tgUserId,
        isPremium: c.isPremium,
        priorityScore: c.priorityScore,
      })),
    };
  }

  /** 列出所有引流任务（按 huntTaskId 去重，给筛选 dropdown 用） */
  async listHuntTasks(tenantId: string): Promise<Array<{ huntTaskId: string; count: number; firstSeen: Date }>> {
    const rows = await this.candidateRepo.createQueryBuilder('c')
      .select('c.huntTaskId', 'huntTaskId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MIN(c.scrapedAt)', 'firstSeen')
      .where('c.tenantId = :tenantId AND c.huntTaskId IS NOT NULL', { tenantId })
      .groupBy('c.huntTaskId')
      .orderBy('"firstSeen"', 'DESC')
      .getRawMany();
    return rows.map(r => ({
      huntTaskId: r.huntTaskId,
      count: parseInt(r.count, 10),
      firstSeen: new Date(r.firstSeen),
    }));
  }
}
