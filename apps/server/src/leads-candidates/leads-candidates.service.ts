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
  scrapedByAccountId?: string | null;
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
        // 已存在 → 仅补全空字段，不覆盖已有 username/name
        let dirty = false;
        if (!found.tgUsername && it.tgUsername) { found.tgUsername = it.tgUsername; dirty = true; }
        if (!found.firstName && it.firstName) { found.firstName = it.firstName; dirty = true; }
        if (!found.lastName && it.lastName) { found.lastName = it.lastName; dirty = true; }
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
          scrapedByAccountId: it.scrapedByAccountId ?? null,
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

  /** 列出 pending 候选人（agent 触达任务前过滤可用 target）。 */
  async listPending(tenantId: string, limit = 50): Promise<LeadCandidate[]> {
    return this.repo.find({
      where: { tenantId, status: CandidateStatus.PENDING },
      order: { priorityScore: 'DESC', scrapedAt: 'ASC' },
      take: limit,
    });
  }

  async findAll(tenantId: string, status?: CandidateStatus): Promise<LeadCandidate[]> {
    return this.repo.find({
      where: status ? { tenantId, status } : { tenantId },
      order: { scrapedAt: 'DESC' },
      take: 500,
    });
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

  async stats(tenantId: string): Promise<Record<CandidateStatus | 'total', number>> {
    const all = await this.repo.find({ where: { tenantId } });
    const out: any = {
      total: all.length,
      pending: 0, contacted: 0, replied: 0, converted: 0, blocked: 0, expired: 0,
    };
    for (const c of all) out[c.status] = (out[c.status] ?? 0) + 1;
    return out;
  }

  async remove(id: string): Promise<void> {
    const c = await this.findOne(id);
    await this.repo.remove(c);
  }
}
