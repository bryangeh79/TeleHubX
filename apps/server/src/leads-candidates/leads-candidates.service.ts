import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CandidateStatus, LeadCandidate } from './lead-candidate.entity';

export interface BulkUpsertItem {
  tgUserId: string;
  tgUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  sourceGroupId?: string | null;
  sourceGroupTitle?: string | null;
  phone?: string | null;
  lastSeenAt?: string | null;     // ISO string from agent
  isPremium?: boolean;
  isBot?: boolean;
  scrapedByAccountId?: string | null;
  huntTaskId?: string | null;
  priorityScore?: number;
}

@Injectable()
export class LeadCandidatesService {
  constructor(
    @InjectRepository(LeadCandidate)
    private readonly repo: Repository<LeadCandidate>,
  ) {}

  /**
   * 批量 upsert 候选人（按 tenantId+tgUserId 唯一）。
   * agent 端的 group_scrape 调用此接口写入。
   * 返回 { inserted, updated } 计数。
   */
  async bulkUpsert(
    tenantId: string,
    items: BulkUpsertItem[],
  ): Promise<{ inserted: number; updated: number }> {
    if (!items.length) return { inserted: 0, updated: 0 };

    const tgIds = items.map((i) => i.tgUserId);
    const existing = await this.repo.find({
      where: { tenantId, tgUserId: In(tgIds) },
    });
    const existingMap = new Map(existing.map((e) => [e.tgUserId, e]));

    let inserted = 0;
    let updated = 0;
    const now = new Date();

    for (const it of items) {
      const found = existingMap.get(it.tgUserId);
      if (found) {
        // 已存在 → 仅补全空字段, 不覆盖已有
        let dirty = false;
        if (!found.tgUsername && it.tgUsername) { found.tgUsername = it.tgUsername; dirty = true; }
        if (!found.firstName && it.firstName) { found.firstName = it.firstName; dirty = true; }
        if (!found.lastName && it.lastName) { found.lastName = it.lastName; dirty = true; }
        if (!found.sourceGroupTitle && it.sourceGroupTitle) { found.sourceGroupTitle = it.sourceGroupTitle; dirty = true; }
        if (!found.phone && it.phone) { found.phone = it.phone; dirty = true; }
        if (!found.lastSeenAt && it.lastSeenAt) { found.lastSeenAt = new Date(it.lastSeenAt); dirty = true; }
        if (dirty) {
          await this.repo.save(found);
          updated++;
        }
      } else {
        const cand = this.repo.create({
          tenantId,
          tgUserId: it.tgUserId,
          tgUsername: it.tgUsername ?? null,
          firstName: it.firstName ?? null,
          lastName: it.lastName ?? null,
          sourceGroupId: it.sourceGroupId ?? null,
          sourceGroupTitle: it.sourceGroupTitle ?? null,
          phone: it.phone ?? null,
          lastSeenAt: it.lastSeenAt ? new Date(it.lastSeenAt) : null,
          isPremium: it.isPremium ?? false,
          isBot: it.isBot ?? false,
          scrapedByAccountId: it.scrapedByAccountId ?? null,
          huntTaskId: it.huntTaskId ?? null,
          scrapedAt: now,
          priorityScore: it.priorityScore ?? 50,
          status: CandidateStatus.PENDING,
        });
        await this.repo.save(cand);
        inserted++;
      }
    }
    return { inserted, updated };
  }

  /** 数 hunt 下来源群分布 (huntTaskId → groupTitle → count) */
  async groupSourcesByHunt(huntTaskId: string): Promise<Array<{ sourceGroupId: string | null; sourceGroupTitle: string | null; count: number }>> {
    const rows = await this.repo
      .createQueryBuilder('c')
      .select('c.sourceGroupId', 'sourceGroupId')
      .addSelect('c.sourceGroupTitle', 'sourceGroupTitle')
      .addSelect('COUNT(*)', 'count')
      .where('c.huntTaskId = :id', { id: huntTaskId })
      .groupBy('c.sourceGroupId')
      .addGroupBy('c.sourceGroupTitle')
      .orderBy('"count"', 'DESC')
      .getRawMany();
    return rows.map((r) => ({
      sourceGroupId: r.sourceGroupId,
      sourceGroupTitle: r.sourceGroupTitle,
      count: parseInt(r.count, 10),
    }));
  }

  /** 数某个 hunt 任务下累计爬到的候选人数 (含已联系 / 已转 / 黑名单 / 过期等所有状态) */
  async countByHunt(huntTaskId: string): Promise<number> {
    return this.repo.count({ where: { huntTaskId } });
  }

  /** 数某个 hunt 已触达的候选人 (status = contacted / replied / converted) */
  async countContactedByHunt(huntTaskId: string): Promise<number> {
    const all = await this.repo.find({ where: { huntTaskId } });
    return all.filter((c) =>
      c.status === CandidateStatus.CONTACTED ||
      c.status === CandidateStatus.REPLIED ||
      c.status === CandidateStatus.CONVERTED,
    ).length;
  }

  /** 取 hunt 下 pending 候选人 (用于阶段 4 contact_add 动态选目标) */
  async listPendingByHunt(huntTaskId: string, limit: number): Promise<LeadCandidate[]> {
    return this.repo.find({
      where: { huntTaskId, status: CandidateStatus.PENDING },
      order: { priorityScore: 'DESC' },
      take: limit,
    });
  }

  /** 列出 pending 候选人（agent 触达任务前过滤可用 target）。 */
  async listPending(tenantId: string, limit = 50): Promise<LeadCandidate[]> {
    return this.repo.find({
      where: { tenantId, status: CandidateStatus.PENDING },
      order: { priorityScore: 'DESC', scrapedAt: 'ASC' },
      take: limit,
    });
  }

  async findAll(tenantId: string, status?: CandidateStatus, onlyUnpacked?: boolean): Promise<LeadCandidate[]> {
    const qb = this.repo.createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .orderBy('c.scrapedAt', 'DESC')
      .limit(500);
    if (status) qb.andWhere('c.status = :status', { status });
    if (onlyUnpacked) {
      qb.andWhere(`(c."packedIntoGroupIds" IS NULL OR c."packedIntoGroupIds" = '')`);
    }
    return qb.getMany();
  }

  async findOne(id: string): Promise<LeadCandidate> {
    const c = await this.repo.findOneBy({ id });
    if (!c) throw new NotFoundException(`Candidate ${id} not found`);
    return c;
  }

  /** 标记已联系（CONTACT_ADD / CAMPAIGN_SINGLE 任务执行成功后回写）。 */
  async markContacted(
    id: string,
    contactedByAccountId: string,
    contactTaskId?: string,
  ): Promise<LeadCandidate> {
    const c = await this.findOne(id);
    c.status = CandidateStatus.CONTACTED;
    c.contactedByAccountId = contactedByAccountId;
    c.contactTaskId = contactTaskId ?? null;
    c.contactedAt = new Date();
    return this.repo.save(c);
  }

  async stats(tenantId: string): Promise<{
    total: number;
    pending: number; contacted: number; replied: number; converted: number; blocked: number; expired: number;
    todayNew: number;
    unpackedCount: number;
  }> {
    const all = await this.repo.find({ where: { tenantId } });
    const out: any = {
      total: all.length,
      pending: 0, contacted: 0, replied: 0, converted: 0, blocked: 0, expired: 0,
      todayNew: 0,
      unpackedCount: 0,
    };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    for (const c of all) {
      out[c.status] = (out[c.status] ?? 0) + 1;
      if (c.scrapedAt && new Date(c.scrapedAt) >= todayStart) out.todayNew++;
      if (!c.packedIntoGroupIds || c.packedIntoGroupIds.length === 0) out.unpackedCount++;
    }
    return out;
  }

  async remove(id: string): Promise<void> {
    const c = await this.findOne(id);
    await this.repo.remove(c);
  }
}
