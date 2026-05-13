import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ensureTenant } from '../auth/tenant-guard.util';
import { TasksService } from '../tasks/tasks.service';
import { TaskType } from '../tasks/task.entity';
import {
  DiscoveredGroup,
  DiscoveredGroupKind,
  DiscoveredGroupStatus,
  DiscoverSource,
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
  // vmfix28 新字段（all optional, 兼容老调用方）
  discoverSource?: DiscoverSource;     // #2 来源
  aiScore?: number | null;             // B2 AI 评分
  aiReason?: string | null;            // B2 评分原因
  recentMessageRate?: number;          // B4 最近 7d 消息占比 (0-100)
}

@Injectable()
export class DiscoveredGroupsService {
  constructor(
    @InjectRepository(DiscoveredGroup) private readonly repo: Repository<DiscoveredGroup>,
    private readonly tasks: TasksService,
  ) {}

  /**
   * vmfix27 #B1: 4 维度综合质量评分 0-100（每维 25 分 + 类型 bonus/惩罚）。
   *
   * 老逻辑（vmfix25 及以前）撞 binary tendency：
   *   - 实测分布: A(≥80)=17 / B(60-80)=1 / C(30-60)=0 / D(<30)=19
   *   - 原因: hasRealSenders=true → +30 / participantsCount 1k-50k → +30 太陡峭，
   *     非黑即白，缺乏区分度
   *
   * 新四维（25 分各）：
   *   1. size_dim     — 成员数 (50-50k 是 sweet spot)
   *   2. activity_dim — hasRealSenders + 抽样真发言者数
   *   3. relevance_dim — 搜索关键词在 title/username 出现 (匹配度)
   *   4. kind_dim     — kind=basic 最高, mega 次, channel 最低
   *
   * 加 penalty:
   *   - isGigagroup       : -10（非 admin 不能 list 成员）
   *   - participantsCount未知: -5
   */
  private computeQuality(g: Partial<DiscoveredGroup>): number {
    // ── 1. size_dim (0-25): 成员数 sweet spot 1k-10k ──
    let sizeDim = 0;
    const n = g.participantsCount ?? -1;
    if (n < 0)                          sizeDim = 5;   // unknown，给最低分但非 0
    else if (n < 50)                    sizeDim = 3;   // 太小
    else if (n < 1_000)                 sizeDim = 15;  // 中等
    else if (n < 10_000)                sizeDim = 25;  // sweet spot
    else if (n < 50_000)                sizeDim = 22;
    else if (n < 200_000)               sizeDim = 18;
    else                                 sizeDim = 12;  // 太大 (gigagroup 风险)

    // ── 2. activity_dim (0-25): 真用户活跃度 ──
    let activityDim = 0;
    const realSenders = g.sampledRealSenders ?? 0;
    if (!g.hasRealSenders) {
      activityDim = 0;  // 全 anonymous broadcast，无引流价值
    } else if (realSenders >= 30)       activityDim = 25;
    else if (realSenders >= 10)         activityDim = 18;
    else if (realSenders >= 5)          activityDim = 12;
    else if (realSenders >= 1)          activityDim = 6;
    else                                 activityDim = 3;

    // ── 3. relevance_dim (0-25): 关键词出现在 title/username ──
    let relevanceDim = 0;
    if (g.keyword) {
      const kw = g.keyword.toLowerCase();
      // 关键词可能有多个（空格分隔），算几个 token 命中
      const tokens = kw.split(/\s+/).filter((t) => t.length >= 2);
      if (tokens.length) {
        const title = (g.title ?? '').toLowerCase();
        const uname = (g.tgUsername ?? '').toLowerCase();
        let hits = 0;
        for (const t of tokens) {
          if (title.includes(t)) hits += 1.5;     // title 命中权重更高
          else if (uname.includes(t)) hits += 1;
        }
        const ratio = Math.min(1, hits / (tokens.length * 1.5));
        relevanceDim = Math.round(ratio * 25);
      } else {
        relevanceDim = 10;  // 无 token 可比 → 给中位
      }
    } else {
      relevanceDim = 10;  // 没记录关键词 → 中位
    }

    // ── 4. kind_dim (0-25): 群类型偏好 ──
    let kindDim = 10;
    if (g.kind === DiscoveredGroupKind.BASIC)        kindDim = 25;  // 基础群 = 小私密 + 真讨论
    else if (g.kind === DiscoveredGroupKind.MEGA)    kindDim = 22;  // 大群 = 主要营销目标
    else if (g.kind === DiscoveredGroupKind.CHANNEL) kindDim = 0;   // 频道无法爬成员

    // ── penalty 叠加 ──
    let penalty = 0;
    if (g.isGigagroup) penalty += 10;
    if (n < 0) penalty += 5;

    // vmfix28 B4: 最近 7 天消息占比 >= 50% 额外加 5 分（活跃热度加成）
    let hotBonus = 0;
    if ((g.recentMessageRate ?? 0) >= 50) hotBonus = 5;

    const total = sizeDim + activityDim + relevanceDim + kindDim + hotBonus - penalty;
    return Math.max(0, Math.min(100, total));
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

  async getByIdScoped(id: string, callerTenantId: string | null): Promise<DiscoveredGroup> {
    const g = await this.repo.findOneBy({ id });
    return ensureTenant(g, callerTenantId, 'DiscoveredGroup');
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
        // vmfix28 新字段透传
        discoverSource: it.discoverSource ?? existing?.discoverSource ?? DiscoverSource.CONTACTS_SEARCH,
        aiScore: it.aiScore ?? existing?.aiScore ?? null,
        aiReason: it.aiReason ?? existing?.aiReason ?? null,
        recentMessageRate: it.recentMessageRate ?? existing?.recentMessageRate ?? 0,
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

  /**
   * vmfix27 #C4 / #D1: 给 agent 用 — 返回最近 N 小时内同关键词已 upsert 的 tgChatIds.
   * agent 拿到后跳过已知群，等价于 24h cache。
   */
  async findRecentByKeyword(
    tenantId: string,
    keyword: string,
    withinHours: number,
  ): Promise<{ tgChatIds: string[]; lastDiscoveredAt: string | null; count: number }> {
    const since = new Date(Date.now() - withinHours * 3600_000);
    const rows = await this.repo.createQueryBuilder('g')
      .select(['g.tgChatId', 'g.updatedAt'])
      .where('g."tenantId" = :tid', { tid: tenantId })
      .andWhere('g.keyword = :kw', { kw: keyword })
      .andWhere('g."updatedAt" >= :since', { since })
      .orderBy('g.updatedAt', 'DESC')
      .getMany();
    return {
      tgChatIds: rows.map((r) => r.tgChatId),
      lastDiscoveredAt: rows[0]?.updatedAt?.toISOString() ?? null,
      count: rows.length,
    };
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
   *
   * vmfix29 NEW-1: 同时把 dispatchedToAccountId / Label / At 写入 discovered_group,
   * 群源发现页可显示「已派发任务 → +60xxxxx」让用户追溯哪个号被分配.
   */
  async queueScrape(id: string, accountId: string): Promise<{ joinTaskId: string; scrapeTaskId: string }> {
    const g = await this.getById(id);
    const now = new Date();
    const scrapeAt = new Date(Date.now() + 10 * 60_000);

    // vmfix29 NEW-1: 查 account label
    const account = await this.repo.manager.findOne(
      (await import('../accounts/account.entity')).Account,
      { where: { id: accountId } },
    );
    const accountLabel = account?.phoneNumber ?? accountId.slice(0, 8);

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
        // 标记 → 爬完后自动建客户群（tasks.service autoGroupFromScrape hook）
        _autoGroupFromDiscovered: g.id,
        _autoGroupSourceTitle: g.title,
      },
      scheduledAt: scrapeAt.toISOString(),
    }, g.tenantId ?? undefined);

    g.status = DiscoveredGroupStatus.JOINED;
    // vmfix29 NEW-1: 记录派发账号
    g.dispatchedToAccountId = accountId;
    g.dispatchedToAccountLabel = accountLabel;
    g.dispatchedAt = now;
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
