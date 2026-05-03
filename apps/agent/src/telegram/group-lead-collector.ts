/**
 * 被动群线索采集器（D 方案）
 *
 * 给每个 ad/cs 账号挂一个 NewMessage 事件监听，捕获群消息的发言者，
 * 累计后批量入库到 lead_candidates。补全 GetParticipants 拉不到的潜水群（gigagroup）。
 *
 * 设计：
 * - 单例 Collector：跨账号共享 dedup + 批量 flush
 * - 内存去重：同一 (sourceGroupId, tgUserId) 30 分钟内不重复采集
 * - 批量 flush：每账号攒够 50 条 OR 60 秒触发一次 → bulkUpsertCandidates
 * - 跳过：自己网络、bot、deleted、私聊
 */

import { TelegramClient } from 'telegram';
import { Api } from 'telegram';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { logger } from '../logger';
import { bulkUpsertCandidates, CandidateUpsertItem } from '../tasks/server-callback';

interface QueueItem extends CandidateUpsertItem {
  tenantId: string;
}

const FLUSH_INTERVAL_MS = 60_000;
const MAX_QUEUE_PER_ACCOUNT = 50;
const DEDUP_TTL_MS = 30 * 60_000; // 30 min

class GroupLeadCollector {
  /** accountId → 待入库列表 */
  private queues = new Map<string, QueueItem[]>();
  /** `${accountId}:${groupId}:${tgUserId}` → lastSeen ts，30min 内不重复 */
  private dedup = new Map<string, number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.flushTimer = setInterval(() => void this.flushAll(), FLUSH_INTERVAL_MS);
    // dedup map 老化：每 5 分钟清一次过期 entries
    setInterval(() => this.cleanupDedup(), 5 * 60_000);
    logger.info(`[group-lead-collector] started (flush=${FLUSH_INTERVAL_MS / 1000}s, batch=${MAX_QUEUE_PER_ACCOUNT})`);
  }

  collect(accountId: string, item: QueueItem): void {
    const dedupKey = `${accountId}:${item.sourceGroupId}:${item.tgUserId}`;
    const now = Date.now();
    const last = this.dedup.get(dedupKey);
    if (last && now - last < DEDUP_TTL_MS) return;
    this.dedup.set(dedupKey, now);

    const q = this.queues.get(accountId) ?? [];
    q.push(item);
    this.queues.set(accountId, q);
    if (q.length >= MAX_QUEUE_PER_ACCOUNT) {
      void this.flush(accountId);
    }
  }

  async flush(accountId: string): Promise<void> {
    const items = this.queues.get(accountId);
    if (!items?.length) return;
    this.queues.set(accountId, []);
    // 按 tenantId 分组（账号可能多 tenant 共存）
    const byTenant = new Map<string, CandidateUpsertItem[]>();
    for (const it of items) {
      const { tenantId, ...rest } = it;
      const arr = byTenant.get(tenantId) ?? [];
      arr.push(rest);
      byTenant.set(tenantId, arr);
    }
    let total = 0;
    for (const [tenantId, list] of byTenant) {
      const res = await bulkUpsertCandidates(tenantId, list).catch(() => null);
      total += res?.inserted ?? 0;
    }
    if (total > 0) {
      logger.info(`[group-lead-collector] flush account=${accountId.slice(0, 8)} inserted=${total} (queued=${items.length})`);
    }
  }

  async flushAll(): Promise<void> {
    for (const accountId of Array.from(this.queues.keys())) {
      await this.flush(accountId);
    }
  }

  private cleanupDedup(): void {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    let removed = 0;
    for (const [k, t] of this.dedup) {
      if (t < cutoff) {
        this.dedup.delete(k);
        removed++;
      }
    }
    if (removed) logger.debug(`[group-lead-collector] dedup cleanup: removed ${removed} expired entries`);
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushAll();
    logger.info(`[group-lead-collector] shutdown ✓`);
  }
}

export const groupLeadCollector = new GroupLeadCollector();

/**
 * 给一个账号的 client 挂上 group lead 收集监听。
 * 与现有 attachMessageHandler 并行运行（不影响 ad/cs 自动回复逻辑）。
 */
export function attachGroupLeadCollector(
  client: TelegramClient,
  opts: {
    accountId: string;
    tenantId: string | null;
    selfTgUserId?: string | null;
    getOwnNetwork?: () => Set<string>;
  },
): void {
  if (!opts.tenantId) {
    logger.debug(`[group-lead-collector] ${opts.accountId.slice(0, 8)} no tenantId, skip listener`);
    return;
  }
  const tenantId = opts.tenantId;

  client.addEventHandler(
    (event: NewMessageEvent) => {
      try {
        const msg = event.message;
        // 仅群/超级群（PeerChat / PeerChannel），跳过私聊
        const isGroup = msg.peerId instanceof Api.PeerChat || msg.peerId instanceof Api.PeerChannel;
        if (!isGroup) return;

        // 提取发言者 user
        const fromId = (msg as any).fromId;
        if (!(fromId instanceof Api.PeerUser)) return;
        const senderId = String(fromId.userId);

        // 跳过自己 + 自家网络（其他自家账号在群里聊天，不该入库）
        if (opts.selfTgUserId && senderId === opts.selfTgUserId) return;
        const ownNet = opts.getOwnNetwork?.();
        if (ownNet?.has(senderId)) return;

        // 拿 sender 信息（GramJS 自动 resolve 到 sender 字段）
        const sender = (msg as any).sender;
        if (!sender || sender.className !== 'User') return;
        if (sender.bot || sender.deleted) return;

        // chat 信息
        const chatId = msg.peerId instanceof Api.PeerChannel
          ? String(msg.peerId.channelId)
          : msg.peerId instanceof Api.PeerChat
          ? String(msg.peerId.chatId)
          : 'unknown';
        const chat = (msg as any).chat;
        const chatTitle = chat?.title ?? null;

        groupLeadCollector.collect(opts.accountId, {
          tenantId,
          tgUserId: senderId,
          tgUsername: sender.username ?? null,
          firstName: sender.firstName ?? null,
          lastName: sender.lastName ?? null,
          sourceGroupId: chatId,
          sourceGroupTitle: chatTitle,
          phone: sender.phone ? `+${sender.phone}` : null,
          isPremium: sender.premium === true,
          isBot: false,
          scrapedByAccountId: opts.accountId,
          // 被动监听 → 高优先级（活跃发言者），priorityScore 75-95
          priorityScore: 75
            + (sender.username ? 10 : 0)
            + (sender.photo ? 5 : 0)
            + (sender.premium ? 3 : 0)
            + (sender.phone ? 8 : 0),
        });
      } catch (err) {
        logger.debug(`[group-lead-collector] handler err: ${(err as Error).message}`);
      }
    },
    new NewMessage({ incoming: true }),
  );
}
