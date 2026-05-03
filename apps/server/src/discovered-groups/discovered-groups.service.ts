import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TasksService } from '../tasks/tasks.service';
import { TaskType } from '../tasks/task.entity';
import {
  DiscoveredGroup,
  DiscoveredGroupKind,
  DiscoveredGroupStatus,
} from './discovered-group.entity';

export interface DiscoveredGroupUpsertItem {
  tgChatId: string;
  tgUsername?: string | null;
  title: string;
  kind: DiscoveredGroupKind;
  participantsCount?: number;
  isGigagroup?: boolean;
  hasRealSenders?: boolean;
  sampledMessages?: number;
  sampledRealSenders?: number;
  keyword?: string | null;
  discoveredByAccountId?: string | null;
  discoverTaskId?: string | null;
}

@Injectable()
export class DiscoveredGroupsService {
  constructor(
    @InjectRepository(DiscoveredGroup) private readonly repo: Repository<DiscoveredGroup>,
    private readonly tasks: TasksService,
  ) {}

  /**
   * 综合质量评分 0-100：
   * - 基础 30 分
   * - participantsCount: 50-1k → +10, 1k-50k → +30 (sweet spot), 50k-200k → +20
   * - isGigagroup → -30（非 admin 不能 list 成员）
   * - kind=channel → -50（频道无法爬成员）
   * - kind=basic → +10（基础群一般有真讨论）
   * - hasRealSenders=true → +30
   * - sampledRealSenders >= 10 → +20
   */
  private computeQuality(g: Partial<DiscoveredGroup>): number {
    let score = 30;
    const n = g.participantsCount ?? -1;
    if (n >= 50 && n < 1000) score += 10;
    else if (n >= 1000 && n < 50_000) score += 30;
    else if (n >= 50_000 && n < 200_000) score += 20;
    else if (n >= 200_000) score += 10;

    if (g.isGigagroup) score -= 30;
    if (g.kind === DiscoveredGroupKind.CHANNEL) score -= 50;
    if (g.kind === DiscoveredGroupKind.BASIC) score += 10;
    if (g.hasRealSenders) score += 30;
    if ((g.sampledRealSenders ?? 0) >= 10) score += 20;

    return Math.max(0, Math.min(100, score));
  }

  async list(filter: {
    tenantId?: string;
    status?: DiscoveredGroupStatus;
    minQuality?: number;
    keyword?: string;
    limit?: number;
  }): Promise<DiscoveredGroup[]> {
    const qb = this.repo.createQueryBuilder('g').orderBy('g.qualityScore', 'DESC').addOrderBy('g.participantsCount', 'DESC');
    if (filter.tenantId) qb.andWhere('g."tenantId" = :tid', { tid: filter.tenantId });
    if (filter.status) qb.andWhere('g.status = :s', { s: filter.status });
    if (filter.minQuality !== undefined) qb.andWhere('g."qualityScore" >= :q', { q: filter.minQuality });
    if (filter.keyword) qb.andWhere('g.keyword ILIKE :kw', { kw: `%${filter.keyword}%` });
    qb.limit(filter.limit ?? 200);
    return qb.getMany();
  }

  async getById(id: string): Promise<DiscoveredGroup> {
    const g = await this.repo.findOneBy({ id });
    if (!g) throw new NotFoundException(`DiscoveredGroup ${id} not found`);
    return g;
  }

  /**
   * 批量 upsert（agent discover executor 调用）。
   * 同 (tenantId, tgChatId) 已存在则合并 + 重算 qualityScore。
   */
  async bulkUpsert(
    tenantId: string,
    items: DiscoveredGroupUpsertItem[],
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;
    for (const it of items) {
      if (!it?.tgChatId || !it?.title) continue;
      const existing = await this.repo.findOne({ where: { tenantId, tgChatId: it.tgChatId } });
      const merged: Partial<DiscoveredGroup> = {
        tenantId,
        tgChatId: it.tgChatId,
        tgUsername: it.tgUsername ?? existing?.tgUsername ?? null,
        title: it.title,
        kind: it.kind,
        participantsCount: it.participantsCount ?? existing?.participantsCount ?? -1,
        isGigagroup: it.isGigagroup ?? existing?.isGigagroup ?? false,
        hasRealSenders: it.hasRealSenders ?? existing?.hasRealSenders ?? false,
        sampledMessages: it.sampledMessages ?? existing?.sampledMessages ?? 0,
        sampledRealSenders: it.sampledRealSenders ?? existing?.sampledRealSenders ?? 0,
        keyword: it.keyword ?? existing?.keyword ?? null,
        discoveredByAccountId: it.discoveredByAccountId ?? existing?.discoveredByAccountId ?? null,
        discoverTaskId: it.discoverTaskId ?? existing?.discoverTaskId ?? null,
        // 已忽略的群不重置状态（避免重新 discover 时把租户的决定撤销）
        status: existing?.status ?? DiscoveredGroupStatus.NEW,
      };
      merged.qualityScore = this.computeQuality(merged);
      if (existing) {
        Object.assign(existing, merged);
        await this.repo.save(existing);
        updated++;
      } else {
        await this.repo.save(this.repo.create(merged));
        inserted++;
      }
    }
    return { inserted, updated };
  }

  async setStatus(id: string, status: DiscoveredGroupStatus): Promise<DiscoveredGroup> {
    const g = await this.getById(id);
    g.status = status;
    return this.repo.save(g);
  }

  async bulkSetStatus(ids: string[], status: DiscoveredGroupStatus): Promise<{ updated: number }> {
    if (!ids.length) return { updated: 0 };
    const res = await this.repo.update({ id: In(ids) }, { status });
    return { updated: res.affected ?? 0 };
  }

  /**
   * 派发 join + scrape 任务（人工挑选某群后调用）。
   * 串两个任务：JOIN_GROUPS 立即执行；GROUP_SCRAPE 延后 10 分钟（让群同步到 dialogs）。
   */
  async queueScrape(id: string, accountId: string): Promise<{ joinTaskId: string; scrapeTaskId: string }> {
    const g = await this.getById(id);
    const now = new Date();
    const scrapeAt = new Date(Date.now() + 10 * 60_000);

    // GramJS getEntity 需要 @username 或带前缀的 channel id（megagroup/channel: -100xxx，basic chat: -xxx）
    // 否则纯数字会被当 PeerUser 解释 → "Could not find input entity"
    const target = g.tgUsername
      ? `@${g.tgUsername}`
      : g.kind === 'basic'
        ? `-${g.tgChatId}`
        : `-100${g.tgChatId}`;

    const joinTask = await this.tasks.create({
      name: `加群: ${g.title.slice(0, 40)}`,
      type: TaskType.JOIN_GROUPS,
      accountId,
      payload: {
        chatIds: [target],
        inviteIntervalSec: [60, 180],
      },
      scheduledAt: now.toISOString(),
    }, g.tenantId ?? undefined);

    const scrapeTask = await this.tasks.create({
      name: `爬群: ${g.title.slice(0, 40)}`,
      type: TaskType.GROUP_SCRAPE,
      accountId,
      payload: {
        tgChatIds: [target],
        maxScrapePerGroup: 200,
      },
      scheduledAt: scrapeAt.toISOString(),
    }, g.tenantId ?? undefined);

    g.status = DiscoveredGroupStatus.JOINED;
    await this.repo.save(g);

    return { joinTaskId: joinTask.id, scrapeTaskId: scrapeTask.id };
  }

  async remove(id: string): Promise<void> {
    const g = await this.getById(id);
    await this.repo.remove(g);
  }

  async stats(tenantId?: string): Promise<{ total: number; byStatus: Record<string, number>; avgQuality: number }> {
    const qb = this.repo.createQueryBuilder('g');
    if (tenantId) qb.where('g."tenantId" = :tid', { tid: tenantId });
    const all = await qb.getMany();
    const byStatus: Record<string, number> = {};
    let qSum = 0;
    for (const g of all) {
      byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
      qSum += g.qualityScore;
    }
    return {
      total: all.length,
      byStatus,
      avgQuality: all.length ? Math.round(qSum / all.length) : 0,
    };
  }
}
