import { Api, type TelegramClient } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import { gaussianDelayMs, sendMessageLikeHuman, simulateReading, sleep } from './behavior-simulator';
import { muteAccount, unmuteAccount } from './script-mute';
import {
  bulkUpsertCandidates,
  bulkUpsertDiscoveredGroups,
  DiscoveredGroupUpsertItem,
  fetchAssetById,
  fetchAssetFile,
  markCandidateContacted,
  pickRandomAsset,
  pickRandomChatScript,
  reportCampaignSent,
} from './server-callback';

/**
 * 每个 executor 的合约：
 *   - 输入：client + payload
 *   - 输出：成功 = void，失败 = throw Error（消息会被 server 记到 Task.errorMsg）
 *   - FloodWait 错误会被上层 catch 并触发账号隔离
 */

export interface ExecutorCtx {
  client: TelegramClient;
  /** 任务记录的 payload jsonb 字段（每种 task 自己定义结构） */
  payload: Record<string, any>;
  /** 报告进度（0-100），上层会 PATCH /tasks/:id */
  reportProgress?: (pct: number) => Promise<void>;
  /** 任务自身的 id（写 lead_candidates.contactTaskId 用） */
  taskId?: string;
  /** 执行任务的账号 id (UUID) */
  accountId?: string;
  /** 租户 id —— group_scrape 写候选池必须有 */
  tenantId?: string;
  /** 本 agent 内所有连接的 client，按 accountId 索引。chat_script_* 多账号编排用 */
  clients?: Map<string, TelegramClient>;
}

/**
 * Per-RPC 超时 wrapper —— GramJS 在 proxy/网络抖动时会无限 hang，没有自带 per-call timeout。
 * 包一层 Promise.race 让单个 RPC 调用最多等 ms 毫秒，超时直接 reject，
 * 避免整个 task 卡到 watchdog 10min 才被杀。
 */
async function withRpcTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`RPC timeout (${ms}ms): ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── 1. IDLE_KEEPALIVE ───────────────────────────────────────────────
/** 让账号在 TG 显示在线，无副作用，最简单的执行器 — 用来验证整条链路。 */
export async function idleKeepalive(ctx: ExecutorCtx): Promise<void> {
  await ctx.client.invoke(new Api.account.UpdateStatus({ offline: false }));
  await ctx.reportProgress?.(100);
}

// ─── 2. JOIN_CHANNELS ────────────────────────────────────────────────
/**
 * payload: { channels: string[] } — 数组里每条可以是 @username 或 https://t.me/joinchat/xxx
 */
export async function joinChannels(ctx: ExecutorCtx): Promise<void> {
  const channels: string[] = ctx.payload.channels ?? [];
  if (!channels.length) throw new Error('payload.channels 为空');
  for (let i = 0; i < channels.length; i++) {
    const target = channels[i].trim();
    try {
      if (target.startsWith('https://t.me/+') || target.includes('joinchat')) {
        // 邀请链接 → ImportChatInvite
        const hash = target.split('/').pop()?.replace('+', '') ?? '';
        await ctx.client.invoke(new Api.messages.ImportChatInvite({ hash }));
      } else {
        // @username → JoinChannel
        const username = target.replace(/^@/, '').replace(/^https:\/\/t\.me\//, '');
        const entity = await ctx.client.getEntity(username);
        await ctx.client.invoke(new Api.channels.JoinChannel({ channel: entity as any }));
      }
    } catch (err) {
      // USER_ALREADY_PARTICIPANT 视为成功
      const e = (err as Error).message ?? '';
      if (!e.includes('ALREADY_PARTICIPANT')) throw err;
    }
    await ctx.reportProgress?.(Math.round(((i + 1) / channels.length) * 100));
    if (i < channels.length - 1) {
      // 加群间隔 60-180s Gaussian
      await sleep(gaussianDelayMs(60_000, 180_000));
    }
  }
}

// ─── 3. BROWSE_CHANNEL ───────────────────────────────────────────────
/**
 * 模拟阅读频道。打开频道、拉历史、停留 N 秒像真人在看，最后点几条 reaction（可选）。
 *
 * payload: { channels: string[], readDurationSec?: [min,max] }
 */
export async function browseChannel(ctx: ExecutorCtx): Promise<void> {
  // 默认 fallback 公开频道池 —— payload.channels 为空时用这些保底，永不抛 "channels 为空"
  const FALLBACK_CHANNELS = ['telegram', 'durov', 'trendingbot'];
  let channels: string[] = ctx.payload.channels ?? [];
  if (!channels.length) channels = FALLBACK_CHANNELS;
  const [minSec, maxSec] = (ctx.payload.readDurationSec as [number, number]) ?? [20, 90];

  let visited = 0;
  const errors: string[] = [];
  for (let i = 0; i < channels.length; i++) {
    const target = channels[i].trim().replace(/^@/, '').replace(/^https:\/\/t\.me\//, '');
    try {
      const entity = await withRpcTimeout(ctx.client.getEntity(target), 60_000, `getEntity(${target})`);
      await withRpcTimeout(ctx.client.getMessages(entity, { limit: 20 }), 60_000, `getMessages(${target})`);
      await simulateReading(minSec, maxSec);
      visited++;
    } catch (err: any) {
      // 单个频道挂掉 → 记录但继续下一个，不让一个坏频道拖垮整 task
      errors.push(`${target}: ${err?.message ?? String(err)}`);
    }
    await ctx.reportProgress?.(Math.round(((i + 1) / channels.length) * 100));
  }
  // 至少访问一个就算成功；全 0 才 throw
  if (visited === 0) throw new Error(`browse_channel 全部目标失败: ${errors.join(' | ')}`);
}

// ─── 4. REACTION_BOOST ───────────────────────────────────────────────
/**
 * 给频道/群里最近的几条消息加 reaction，模拟"路过点个赞"。
 *
 * payload: { tgChatId: string, count?: [min,max], emojiPool?: string[] }
 */
export async function reactionBoost(ctx: ExecutorCtx): Promise<void> {
  const { tgChatId } = ctx.payload;
  if (!tgChatId) throw new Error('payload.tgChatId 必填');
  const [minCount, maxCount] = (ctx.payload.count as [number, number]) ?? [3, 8];
  const emojiPool: string[] = ctx.payload.emojiPool ?? ['👍', '❤️', '🔥', '🎉', '🤔'];
  const targetCount = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;

  const entity = await withRpcTimeout(ctx.client.getEntity(tgChatId), 60_000, `getEntity(${tgChatId})`);
  const recent = await withRpcTimeout(ctx.client.getMessages(entity, { limit: 50 }), 60_000, `getMessages(${tgChatId})`);
  if (!recent.length) return;

  // 随机挑 N 条加 reaction
  const picks = recent.sort(() => 0.5 - Math.random()).slice(0, Math.min(targetCount, recent.length));
  for (let i = 0; i < picks.length; i++) {
    const msg = picks[i];
    const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)];
    try {
      await ctx.client.invoke(
        new Api.messages.SendReaction({
          peer: entity as any,
          msgId: msg.id,
          reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
        }),
      );
    } catch {
      // 个别消息不允许 reaction，跳过
    }
    await ctx.reportProgress?.(Math.round(((i + 1) / picks.length) * 100));
    if (i < picks.length - 1) {
      // reaction 间隔 5-30s
      await sleep(gaussianDelayMs(5_000, 30_000));
    }
  }
}

// ─── 5. GROUP_BUBBLE ─────────────────────────────────────────────────
/**
 * 群内冒泡：在指定群发短句，模拟"路过说一句"。
 *
 * payload: { tgChatId: string, count?: [min,max], textPool?: string[] }
 */
export async function groupBubble(ctx: ExecutorCtx): Promise<void> {
  const { tgChatId } = ctx.payload;
  if (!tgChatId) throw new Error('payload.tgChatId 必填');
  const [minCount, maxCount] = (ctx.payload.count as [number, number]) ?? [1, 2];
  const defaultPool = [
    '👍', '了解', '收到', '👌', '嗯嗯', '好的',
    '哈哈', '不错', '是的', '😂', '👏', '🤝',
    '明白了', 'ok',
  ];
  const textPool: string[] = (ctx.payload.textPool as string[])?.length
    ? ctx.payload.textPool
    : defaultPool;
  const count = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;

  const entity = await ctx.client.getEntity(tgChatId);
  for (let i = 0; i < count; i++) {
    const text = textPool[Math.floor(Math.random() * textPool.length)];
    await sendMessageLikeHuman(ctx.client, entity, text);
    await ctx.reportProgress?.(Math.round(((i + 1) / count) * 100));
    if (i < count - 1) {
      // 冒泡间隔 5-30 分钟（不要连刷）
      await sleep(gaussianDelayMs(5 * 60_000, 30 * 60_000));
    }
  }
}

// ─── 6. JOIN_GROUPS ──────────────────────────────────────────────────
/**
 * 加群（邀请链接 / @username / chatId 列表）。与 join_channels 共用底层调用，
 * 但参数名换成 inviteLinks/chatIds 以对齐 task.entity 里的命名。
 *
 * payload: { inviteLinks?: string[], chatIds?: string[], inviteIntervalSec?: [60,180] }
 */
export async function joinGroups(ctx: ExecutorCtx): Promise<void> {
  const links: string[] = (ctx.payload.inviteLinks ?? []) as string[];
  const chatIds: string[] = (ctx.payload.chatIds ?? []) as string[];
  const all = [...links, ...chatIds].map((s) => s.trim()).filter(Boolean);
  if (!all.length) throw new Error('payload.inviteLinks 或 chatIds 至少要有一个');

  const [minSec, maxSec] = (ctx.payload.inviteIntervalSec as [number, number]) ?? [60, 180];

  for (let i = 0; i < all.length; i++) {
    const target = all[i];
    try {
      if (target.includes('joinchat') || target.includes('t.me/+')) {
        const hash = target.split('/').pop()?.replace('+', '') ?? '';
        await ctx.client.invoke(new Api.messages.ImportChatInvite({ hash }));
      } else {
        const username = target.replace(/^@/, '').replace(/^https:\/\/t\.me\//, '');
        const entity = await ctx.client.getEntity(username);
        await ctx.client.invoke(new Api.channels.JoinChannel({ channel: entity as any }));
      }
    } catch (err) {
      const e = (err as Error).message ?? '';
      if (!e.includes('ALREADY_PARTICIPANT')) throw err;
    }
    await ctx.reportProgress?.(Math.round(((i + 1) / all.length) * 100));
    if (i < all.length - 1) {
      await sleep(gaussianDelayMs(minSec * 1000, maxSec * 1000));
    }
  }
}

// ─── 7. ACCEPT_INVITES ───────────────────────────────────────────────
/**
 * 接受所有 pending 状态的群组邀请（join requests）。
 * 用 messages.GetDialogs 拉所有 dialogs，对每个 channel 检查 hasJoinRequest 并通过。
 *
 * payload: { autoAcceptAll?: true }
 */
export async function acceptInvites(ctx: ExecutorCtx): Promise<void> {
  // 简化实现：拉 dialogs，对每个 channel 调 hideChatJoinRequest(approved=true)
  // 大多数账号不会有大量 pending invites，循环几十个就够
  const dialogs = await ctx.client.getDialogs({ limit: 100 });
  let processed = 0;
  let total = dialogs.length || 1;

  for (const d of dialogs) {
    try {
      const entity: any = d.entity;
      // 只处理 channel/megagroup 且自己是 pending
      if (!entity || !entity.id) continue;
      if (entity.left === true || entity.kicked === true) continue;
      // 试着 approve（若没有 pending 请求，TG 会返回错误，捕获跳过）
      try {
        await ctx.client.invoke(
          new Api.messages.HideAllChatJoinRequests({
            peer: entity,
            approved: true,
          }),
        );
      } catch {
        // 没有 pending 请求 → 忽略
      }
    } finally {
      processed++;
      if (processed % 10 === 0) {
        await ctx.reportProgress?.(Math.round((processed / total) * 100));
      }
      await sleep(gaussianDelayMs(2_000, 8_000));
    }
  }
  await ctx.reportProgress?.(100);
}

// ─── 8. PROFILE_UPDATE ───────────────────────────────────────────────
/**
 * 更新账号资料：firstName / lastName / bio / 头像。
 * 一次只改一个字段，每改一个间隔 30-60 秒（真人不会一次改全部）。
 *
 * payload: { firstName?, lastName?, bio?, photoPath? }
 *   photoPath: 本地图片绝对路径（agent 端可访问）
 */
export async function profileUpdate(ctx: ExecutorCtx): Promise<void> {
  const { firstName, lastName, bio, photoPath } = ctx.payload as {
    firstName?: string; lastName?: string; bio?: string; photoPath?: string;
  };

  const fields = [firstName, lastName, bio, photoPath].filter(Boolean);
  if (fields.length === 0) throw new Error('payload 至少要包含 firstName / lastName / bio / photoPath 之一');

  let step = 0;
  const total = fields.length;

  if (firstName !== undefined || lastName !== undefined || bio !== undefined) {
    await ctx.client.invoke(
      new Api.account.UpdateProfile({
        firstName: firstName ?? undefined,
        lastName:  lastName  ?? undefined,
        about:     bio       ?? undefined,
      }),
    );
    step++;
    await ctx.reportProgress?.(Math.round((step / total) * 100));
    await sleep(gaussianDelayMs(30_000, 60_000));
  }

  if (photoPath) {
    const file = await ctx.client.uploadFile({ file: photoPath as any, workers: 1 });
    await ctx.client.invoke(
      new Api.photos.UploadProfilePhoto({ file: file as any }),
    );
    step++;
    await ctx.reportProgress?.(Math.round((step / total) * 100));
  }
}

// ─── 9. POST_CHANNEL ─────────────────────────────────────────────────
/**
 * 在频道/群发一条文字（未来扩展支持 mediaPath）。
 *
 * payload: { channelId: string, content: string, mediaPath?: string }
 */
export async function postChannel(ctx: ExecutorCtx): Promise<void> {
  // 兼容两套字段名: targetId/content 或 channelId/text (历史)
  const targetId = (ctx.payload.targetId ?? ctx.payload.channelId) as string;
  const content = (ctx.payload.caption ?? ctx.payload.content ?? '') as string;
  const { assetId, poolName } = ctx.payload as { assetId?: string; poolName?: string };
  if (!targetId) throw new Error('payload.targetId / channelId 必填');

  // 手机号格式目标统一 import contact 预热 (适用所有手机号: 内池 / 陌生人 leads)
  if (isPhoneFormat(targetId)) {
    await tryImportContact(ctx.client, targetId);
  }

  const entity = await withTimeout(ctx.client.getEntity(targetId), 15_000, 'getEntity 解析目标超时');
  await ctx.reportProgress?.(20);

  // 如果指定了 assetId 或 poolName, 拉素材附带发出
  let asset = null;
  if (assetId) {
    asset = await fetchAssetById(assetId);
  } else if (poolName) {
    asset = await pickRandomAsset({ poolName, tenantId: ctx.tenantId });
  }

  if (asset) {
    const buf = await fetchAssetFile(asset.id);
    if (buf) {
      const file = new CustomFile(asset.fileName, buf.length, '', buf);
      await ctx.client.sendFile(entity, { file, caption: content, forceDocument: false });
    } else if (content) {
      await sendMessageLikeHuman(ctx.client, entity, content);
    }
  } else if (content) {
    await sendMessageLikeHuman(ctx.client, entity, content);
  } else {
    throw new Error('payload.caption / content 或 assetId / poolName 至少一个');
  }
  await ctx.reportProgress?.(100);
}

// ─── 10. GROUP_SCRAPE ────────────────────────────────────────────────
/**
 * 爬群成员到 LeadCandidate 池。
 *
 * payload: { tgChatIds: string[], maxScrapePerGroup?: 50 }
 * 需 ctx.tenantId + ctx.accountId 才能落库。
 */
export async function groupScrape(ctx: ExecutorCtx): Promise<void> {
  let chatIds: string[] = (ctx.payload.tgChatIds ?? []) as string[];
  const maxPer = (ctx.payload.maxScrapePerGroup as number) ?? 50;

  if (chatIds.length === 0 && ctx.payload.dynamicSource === 'recent_joins') {
    // 取账号所在的所有可爬群（megagroup + basic chat）
    const dialogs = await ctx.client.getDialogs({ limit: 200 });
    const found: string[] = [];
    let totalDialogs = 0;
    let channels = 0;
    let users = 0;
    let basicChats = 0;
    let megagroups = 0;
    const dialogDump: string[] = [];
    for (const d of dialogs) {
      const ent: any = (d as any).entity;
      if (!ent) continue;
      totalDialogs++;
      // 详细 dump（前 20 个），帮诊断"明明加了群但找不到"的怪现象
      if (dialogDump.length < 20) {
        dialogDump.push(
          `[${ent.className}] ${ent.title ?? ent.username ?? ent.firstName ?? '?'} ` +
          `(id=${ent.id} mega=${ent.megagroup} broadcast=${ent.broadcast} giga=${ent.gigagroup} ` +
          `forbidden=${ent.className?.includes('Forbidden')})`,
        );
      }
      if (ent.megagroup) {
        megagroups++;
        found.push(String(ent.id));
      } else if (ent.className === 'Chat') {
        basicChats++;
        found.push(String(ent.id));
      } else if (ent.broadcast) {
        channels++;
      } else if (ent.className === 'User') {
        users++;
      }
      if (found.length >= 10) break;
    }
    console.info(`[group_scrape] dialog dump (${totalDialogs} total):\n  ${dialogDump.join('\n  ')}`);
    if (found.length) {
      chatIds = found;
    } else {
      throw new Error(
        `账号当前没有加入任何可爬成员的群（megagroup 或 basic chat）。` +
        `统计：共 ${totalDialogs} 个 dialog · ${megagroups} 超级群 · ${basicChats} 基础群 · ${channels} 频道(不能爬) · ${users} 私聊。` +
        `可能原因：1) 上一步「搜词加群」加的是频道(broadcast)；2) 账号还没加过任何群；3) 加的群被 leave 了。`,
      );
    }
  }

  if (!chatIds.length) throw new Error('payload.tgChatIds 为空');
  if (!ctx.tenantId) throw new Error('ctx.tenantId 缺失（爬完无法落库）');

  const cutoff = Date.now() / 1000 - 30 * 86400; // 30 天活跃过的才要

  let totalInserted = 0;
  const perGroupReport: string[] = [];

  for (let i = 0; i < chatIds.length; i++) {
    const chatId = chatIds[i].trim();
    let groupTitle: string | null = null;
    try {
      const entity: any = await ctx.client.getEntity(chatId);
      groupTitle = entity?.title ?? null;
      const isGiga = entity?.gigagroup === true;

      // 第一步：试 GetParticipants（小 megagroup / basic chat 直接成功）
      let participants: any[] = [];
      let participantError: string | null = null;
      if (!isGiga) {
        try {
          participants = await ctx.client.getParticipants(entity, { limit: 200 }) as any[];
        } catch (e) {
          participantError = (e as Error).message ?? '';
        }
      }

      const items: any[] = [];
      let filteredBot = 0, filteredInactive = 0;
      const seenIds = new Set<string>();

      for (const p of participants) {
        const u: any = p;
        if (u.bot || u.deleted) { filteredBot++; continue; }
        const lastSeenSec = (u.status?.wasOnline as number | undefined) ?? null;
        if (lastSeenSec !== null && lastSeenSec < cutoff) { filteredInactive++; continue; }
        seenIds.add(String(u.id));
        items.push({
          tgUserId: String(u.id),
          tgUsername: u.username ?? null,
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          sourceGroupId: chatId,
          sourceGroupTitle: groupTitle,
          phone: u.phone ? `+${u.phone}` : null,
          lastSeenAt: lastSeenSec ? new Date(lastSeenSec * 1000).toISOString() : null,
          isPremium: u.premium === true,
          isBot: false,
          scrapedByAccountId: ctx.accountId ?? null,
          huntTaskId: (ctx.payload.huntTaskId as string | undefined) ?? null,
          priorityScore: 50
            + (u.username ? 10 : 0)
            + (u.photo ? 5 : 0)
            + (u.premium ? 3 : 0)
            + (u.phone ? 8 : 0),
        });
        if (items.length >= maxPer) break;
      }

      // 第二步：fallback 到 GetHistory 抽发言者（gigagroup 或 GetParticipants 失败/不足时）
      let historyAdded = 0;
      let historyMsgCount = 0;
      const needHistory = items.length < maxPer && (isGiga || participants.length === 0 || participantError);
      if (needHistory) {
        try {
          const historyLimit = Math.min(1000, Math.max(200, maxPer * 5));
          const messages = await ctx.client.getMessages(entity, { limit: historyLimit }) as any[];
          historyMsgCount = messages.length;
          // 收集 unique sender IDs + entities 字段
          const senderIds = new Set<string>();
          let nullSender = 0;
          let channelSender = 0;
          for (const m of messages) {
            // m.fromId 类型可能是 PeerUser / PeerChannel / PeerChat
            const fromId = m.fromId;
            if (!fromId) {
              nullSender++;
              continue;
            }
            // 只要 PeerUser（真用户发的）；PeerChannel = 群本身/admin 匿名签名，不是真人
            if (fromId.className === 'PeerUser') {
              const sid = String(fromId.userId);
              if (!seenIds.has(sid)) senderIds.add(sid);
            } else {
              channelSender++;
            }
          }
          console.info(`[group_scrape] history sample for "${groupTitle}": ${messages.length} msgs, ${senderIds.size} unique users, ${channelSender} channel-signed, ${nullSender} no-sender`);
          // 批量 resolve 用户实体（GramJS getMessages 不自动填充 sender，
          // 需要 client.getEntity 或从 message._sender / event 拿；这里用 getEntity 逐个）
          for (const sid of senderIds) {
            if (items.length >= maxPer) break;
            try {
              const u: any = await ctx.client.getEntity(sid);
              if (!u || u.className !== 'User') continue;
              if (u.bot || u.deleted) continue;
              seenIds.add(sid);
              const lastSeenSec = (u.status?.wasOnline as number | undefined) ?? null;
              items.push({
                tgUserId: sid,
                tgUsername: u.username ?? null,
                firstName: u.firstName ?? null,
                lastName: u.lastName ?? null,
                sourceGroupId: chatId,
                sourceGroupTitle: groupTitle,
                phone: u.phone ? `+${u.phone}` : null,
                lastSeenAt: lastSeenSec ? new Date(lastSeenSec * 1000).toISOString() : null,
                isPremium: u.premium === true,
                isBot: false,
                scrapedByAccountId: ctx.accountId ?? null,
                huntTaskId: (ctx.payload.huntTaskId as string | undefined) ?? null,
                priorityScore: 70
                  + (u.username ? 10 : 0)
                  + (u.photo ? 5 : 0)
                  + (u.premium ? 3 : 0)
                  + (u.phone ? 8 : 0),
              });
              historyAdded++;
            } catch {
              // 个别用户 resolve 失败跳过
            }
          }
        } catch (e) {
          participantError = (participantError ? participantError + '; ' : '') + 'history: ' + (e as Error).message;
        }
      }

      let inserted = 0;
      if (items.length) {
        const result = await bulkUpsertCandidates(ctx.tenantId, items);
        inserted = result?.inserted ?? 0;
        totalInserted += inserted;
      }
      const reportLine = `「${groupTitle ?? chatId}」` +
        `${isGiga ? '[gigagroup→走历史回看]' : ''}` +
        `: 成员API=${participants.length}, 历史拉到=${historyMsgCount}消息→抽发言者=${historyAdded}, ` +
        `过滤bot/已删=${filteredBot}, 过滤30天未活跃=${filteredInactive}, 入库=${inserted}` +
        `${participantError ? ` (注: ${participantError.slice(0, 80)})` : ''}`;
      perGroupReport.push(reportLine);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('CHAT_ADMIN_REQUIRED') || msg.includes('PARTICIPANTS_FORBIDDEN')) {
        perGroupReport.push(`「${groupTitle ?? chatId}」: 群禁止非管理员查看成员列表 (${msg.match(/[A-Z_]+/)?.[0] ?? ''})`);
      } else {
        throw err;
      }
    }

    await ctx.reportProgress?.(Math.round(((i + 1) / chatIds.length) * 100));
    if (i < chatIds.length - 1) {
      // 群之间间隔 10-30 分钟（防 ban）
      await sleep(gaussianDelayMs(10 * 60_000, 30 * 60_000));
    }
  }

  // 总入库 0 → 任务实质失败，给出详细诊断让客户能针对性处理
  if (totalInserted === 0) {
    throw new Error(
      `共爬 ${chatIds.length} 个群，0 候选人入库。详情:\n${perGroupReport.join('\n')}\n\n` +
      `常见原因: 1) 群禁止非管理员查成员；2) 群成员都是 bot 或长期不活跃；3) 群是空群/僵尸群。建议换更活跃的群或调整 30 天活跃过滤窗口。`,
    );
  }
}

// ─── 11. CONTACT_ADD ─────────────────────────────────────────────────
/**
 * 加 contact + 可选发开场白。从 LeadCandidate 池或显式 targets 取目标。
 *
 * payload: {
 *   mode: 'username' | 'phone',
 *   targets?: Array<{ candidateId?, tgUserId?, username?, phone?, firstName?, lastName? }>,
 *   maxPerDay?: 5,
 *   greetingText?: string  // 加完后立即发的开场白（可选）
 * }
 */
export async function contactAdd(ctx: ExecutorCtx): Promise<void> {
  const mode = (ctx.payload.mode ?? 'username') as 'username' | 'phone';
  const targets: any[] = (ctx.payload.targets ?? []) as any[];
  const maxPerDay = (ctx.payload.maxPerDay as number) ?? 5;
  const greeting: string | undefined = ctx.payload.greetingText;
  if (!targets.length) throw new Error('payload.targets 为空');

  const limited = targets.slice(0, maxPerDay);
  for (let i = 0; i < limited.length; i++) {
    const t = limited[i];
    try {
      let entity: any;
      if (mode === 'phone' && t.phone) {
        // ImportContacts → 拿到 user
        const res: any = await ctx.client.invoke(
          new Api.contacts.ImportContacts({
            contacts: [
              new Api.InputPhoneContact({
                clientId: BigInt(Date.now() + i) as any,
                phone: t.phone,
                firstName: t.firstName ?? 'Friend',
                lastName: t.lastName ?? '',
              }),
            ],
          }),
        );
        if (!res.users?.length) continue;
        entity = res.users[0];
      } else {
        const handle = (t.username ?? '').replace(/^@/, '');
        if (!handle) continue;
        entity = await ctx.client.getEntity(handle);
        await ctx.client.invoke(
          new Api.contacts.AddContact({
            id: entity,
            firstName: t.firstName ?? entity.firstName ?? 'Friend',
            lastName: t.lastName ?? entity.lastName ?? '',
            phone: '',
            addPhonePrivacyException: false,
          }),
        );
      }

      // 加完发开场白
      if (greeting) {
        await sleep(gaussianDelayMs(5_000, 15_000));
        await sendMessageLikeHuman(ctx.client, entity, greeting);
      }

      // 候选池回写
      if (t.candidateId && ctx.accountId) {
        await markCandidateContacted(t.candidateId, ctx.accountId, ctx.taskId);
      }
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // 隐私限制 / 已被屏蔽 / 不可达 → 跳过该条不抛
      if (
        msg.includes('USER_PRIVACY_RESTRICTED') ||
        msg.includes('USERNAME_INVALID') ||
        msg.includes('USERNAME_NOT_OCCUPIED') ||
        msg.includes('PEER_ID_INVALID')
      ) {
        // 静默跳过
      } else {
        throw err; // FloodWait / PEER_FLOOD 由上层接管
      }
    }

    await ctx.reportProgress?.(Math.round(((i + 1) / limited.length) * 100));
    if (i < limited.length - 1) {
      await sleep(gaussianDelayMs(3 * 60_000, 10 * 60_000));
    }
  }
}

// ─── 12. CAMPAIGN_SINGLE ─────────────────────────────────────────────
/**
 * 单条群发：targets × variants 矩阵，每条随机抽 variant，间隔 Gaussian。
 *
 * payload: {
 *   targets: Array<string | { username?, candidateId? }>,  // string 视为 username
 *   variants: string[],
 *   intervalSec?: [60, 300]
 * }
 */
/**
 * payload (新版 — Dispatch Service 生成)：
 *   { campaignId, targets: [oneTarget], variants: [{text}], greeting: string|null, intervalSec? }
 * 兼容老版本：targets 可以是 string[] 或 [{username, candidateId}]，variants 可以是 string[] 或 [{text}]
 */
export async function campaignSingle(ctx: ExecutorCtx): Promise<void> {
  const rawTargets = (ctx.payload.targets ?? []) as any[];
  const rawVariants = (ctx.payload.variants ?? []) as any[];
  const greeting = ctx.payload.greeting as string | null | undefined;
  const campaignId = ctx.payload.campaignId as string | undefined;
  const [minSec, maxSec] = (ctx.payload.intervalSec as [number, number]) ?? [60, 300];

  if (!rawTargets.length) throw new Error('payload.targets 为空');
  if (!rawVariants.length) throw new Error('payload.variants 为空');

  // 规范化 variants 池 (老版 string[]; 新版 [{text}])
  const variants: string[] = rawVariants
    .map(v => (typeof v === 'string' ? v : v?.text ?? ''))
    .filter(Boolean);
  if (!variants.length) throw new Error('variants 全部为空');

  for (let i = 0; i < rawTargets.length; i++) {
    const raw = rawTargets[i];
    // 解析目标值：string 直接用；对象支持 username/value/phone
    let value: string;
    let candidateId: string | undefined;
    if (typeof raw === 'string') {
      value = raw.trim();
    } else {
      value = (raw.value ?? raw.username ?? raw.phone ?? '').trim();
      candidateId = raw.candidateId;
    }
    if (!value) continue;

    try {
      // 手机号: 先 ImportContact (TG 协议要求)
      if (isPhoneFormat(value)) {
        await withTimeout(tryImportContact(ctx.client, value), 30_000, 'ImportContact 超时');
      }

      // 解析 entity (用 getEntity, 支持 username/phone/tgUserId) — 30s 超时防卡死
      const entity = await withTimeout(
        ctx.client.getEntity(value.replace(/^@/, '')),
        30_000,
        `解析目标 ${value} 超时`,
      );

      // 选 variant (随机抽)
      const variant = variants[Math.floor(Math.random() * variants.length)];

      // 拼装消息: greeting + \n\n + variant (如果有 greeting)
      const message = greeting ? `${greeting}\n\n${variant}` : variant;
      // 整个 sendMessageLikeHuman（含 typing + sendMessage）60s 超时
      await withTimeout(
        sendMessageLikeHuman(ctx.client, entity, message),
        60_000,
        `发送消息到 ${value} 超时`,
      );

      // 回写: campaign sentCount +1
      if (campaignId) {
        await reportCampaignSent(campaignId, 1);
      }

      // 候选人池标记 contacted
      if (candidateId && ctx.accountId) {
        await markCandidateContacted(candidateId, ctx.accountId, ctx.taskId);
      }
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.includes('USER_PRIVACY_RESTRICTED') ||
        msg.includes('PEER_ID_INVALID') ||
        msg.includes('USERNAME_NOT_OCCUPIED') ||
        msg.includes('USER_BLOCKED_BY_ADMIN') ||
        msg.includes('Could not find the input entity')
      ) {
        // 这些是目标侧问题, 跳过该条不抛 (任务整体仍可视为完成)
      } else {
        throw err;
      }
    }

    await ctx.reportProgress?.(Math.round(((i + 1) / rawTargets.length) * 100));
    if (i < rawTargets.length - 1) {
      await sleep(gaussianDelayMs(minSec * 1000, maxSec * 1000));
    }
  }
}

// ─── 13. JOIN_GROUPS_BY_KEYWORD ─────────────────────────────────────
/**
 * 关键词搜群 + 加群.
 *
 * payload: {
 *   keywords: string[],     // 至少 1 个
 *   minMembers?: 100,       // 群成员下限
 *   maxPerDay?: 2,          // 今天最多加几个
 *   skipUsernames?: string[]  // 已加过的群 (不重复)
 * }
 *
 * 流程:
 * 1. 对每个 keyword 调 contacts.Search(q, limit=30) 拿到 chats[]
 * 2. 过滤 megagroup OR basic chat, 成员 >= minMembers
 * 3. 排序: 按成员数降序 (热门群优先)
 * 4. 加 maxPerDay 个, 间隔 5-15 分钟
 * 5. USER_ALREADY_PARTICIPANT 视为成功跳过
 */
export async function joinGroupsByKeyword(ctx: ExecutorCtx): Promise<void> {
  const keywords: string[] = (ctx.payload.keywords ?? []) as string[];
  const minMembers: number = (ctx.payload.minMembers as number) ?? 100;
  const maxPerDay: number = (ctx.payload.maxPerDay as number) ?? 2;
  const skipUsernames = new Set(((ctx.payload.skipUsernames ?? []) as string[]).map((s) => s.toLowerCase()));

  if (!keywords.length) throw new Error('payload.keywords 不能为空');

  // 默认只加 megagroup + basic chat（这两类才能爬成员引流）。
  // channel/broadcast 不能爬成员（TG 限制），加了等于浪费账号加群配额。
  // 如显式 payload.allowChannels=true 才把 broadcast 也加入候选。
  const allowChannels = ctx.payload.allowChannels === true;
  const candidates: Array<{ entity: any; members: number; title: string; username?: string; kind: 'mega' | 'basic' | 'channel' }> = [];

  for (const kw of keywords) {
    try {
      const res: any = await ctx.client.invoke(
        new Api.contacts.Search({ q: kw.trim(), limit: 30 }),
      );
      const chats = res.chats ?? [];
      for (const c of chats) {
        const isMega = c.megagroup === true;
        const isBasic = c.className === 'Chat';
        const isBroadcast = c.broadcast === true;
        let kind: 'mega' | 'basic' | 'channel' | null = null;
        if (isMega) kind = 'mega';
        else if (isBasic) kind = 'basic';
        else if (isBroadcast && allowChannels) kind = 'channel';
        if (!kind) continue;
        if (c.deactivated || c.kicked) continue;
        // contacts.Search 经常不返回 participantsCount (未加入群拿不到), 默认放行
        const members = (c.participantsCount as number) ?? -1;
        if (members >= 0 && members < minMembers) continue;
        const username = (c.username as string | undefined)?.toLowerCase();
        if (username && skipUsernames.has(username)) continue;
        candidates.push({
          entity: c,
          members,
          title: c.title ?? '',
          username,
          kind,
        });
      }
      // 关键词之间小间隔 (避 search API 风控)
      await sleep(gaussianDelayMs(3_000, 8_000));
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // SEARCH_QUERY_EMPTY 或其他, 跳过这个关键词
      if (!msg.includes('FLOOD')) continue;
      throw err;  // FloodWait 让上层处理
    }
  }

  if (!candidates.length) {
    throw new Error(
      `关键词 [${keywords.join(', ')}] 在 TG 公开搜索里没匹配的群组（megagroup）。` +
      `${allowChannels ? '' : '（已忽略频道 channel —— 频道无法爬成员）'} ` +
      `建议: 1) 关键词换成更具体的（如「forex 中国」「Crypto Singapore」）；2) 直接在「指定群」字段填具体群 id；3) 任务参数加 allowChannels=true 让 channel 也算候选（但 channel 不能爬人）`,
    );
  }

  // 验证候选群真实成员数。contacts.Search 经常不返回 participantsCount，
  // 默认放行会导致僵尸群（实际只有 1-2 个 bot 成员）也被加，浪费配额。
  // 策略：known >=0 直接信任；unknown 用 GetFullChannel 实查；< minMembers 剔除。
  const verifiedSkipped: string[] = [];
  const verified: typeof candidates = [];
  for (const cand of candidates) {
    if (cand.members >= 0) {
      verified.push(cand);
      continue;
    }
    // 已经凑够 maxPerDay × 3 个候选就不再耗 API（留余量给加群失败的回退）
    if (verified.length >= maxPerDay * 3) break;
    try {
      let real = -1;
      let isGigagroup = false;
      if (cand.kind === 'mega' || cand.kind === 'channel') {
        const full: any = await ctx.client.invoke(
          new Api.channels.GetFullChannel({ channel: cand.entity as any }),
        );
        real = (full?.fullChat?.participantsCount as number) ?? -1;
        // 检测 gigagroup（超过 20 万成员的群，TG 自动转换并限制非 admin 查 participants）
        // 实际 entity 上 chat.gigagroup 字段；fullChat 也有
        isGigagroup = (cand.entity as any).gigagroup === true || (full?.chats?.[0]?.gigagroup === true);
      } else if (cand.kind === 'basic') {
        const full: any = await ctx.client.invoke(
          new Api.messages.GetFullChat({ chatId: (cand.entity as any).id }),
        );
        real = (full?.fullChat?.participantsCount as number)
          ?? (full?.fullChat?.participants?.participants?.length as number)
          ?? -1;
      }
      if (isGigagroup) {
        // gigagroup 物理上不能 list 全部成员（仅 admin），加进去也爬不了
        verifiedSkipped.push(`${cand.title}(gigagroup, 不能爬)`);
      } else if (real >= minMembers) {
        cand.members = real;
        verified.push(cand);
      } else {
        verifiedSkipped.push(`${cand.title}(${real}成员)`);
      }
      // 验证之间小间隔（防 API 风控）
      await sleep(gaussianDelayMs(1500, 3500));
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('FLOOD')) throw err;
      verifiedSkipped.push(`${cand.title}(查询失败)`);
    }
  }

  if (!verified.length) {
    throw new Error(
      `关键词 [${keywords.join(', ')}] 找到 ${candidates.length} 个候选群，但全部成员数 < ${minMembers}（僵尸群/空群）。` +
      `已跳过: ${verifiedSkipped.slice(0, 5).join(', ')}${verifiedSkipped.length > 5 ? ` 等 ${verifiedSkipped.length} 个` : ''}。` +
      `建议: 1) 调小 minMembers 阈值；2) 换更具体的关键词；3) 直接在「指定群」字段填活跃群 id`,
    );
  }

  // 按成员数降序，取前 maxPerDay
  verified.sort((a, b) => b.members - a.members);
  const toJoin = verified.slice(0, maxPerDay);

  let joined = 0;
  let alreadyIn = 0;
  const joinReport: string[] = [];
  for (let i = 0; i < toJoin.length; i++) {
    const cand = toJoin[i];
    try {
      await ctx.client.invoke(new Api.channels.JoinChannel({ channel: cand.entity as any }));
      joined++;
      joinReport.push(`✓ 已加入「${cand.title}」(${cand.members}成员, ${cand.kind})`);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('ALREADY_PARTICIPANT')) {
        alreadyIn++;
        joinReport.push(`◎ 已是成员「${cand.title}」(${cand.members}成员)`);
      } else if (msg.includes('CHANNELS_TOO_MUCH')) {
        joinReport.push(`✗ 加群配额已满 (账号 ~500 群上限)`);
        break;
      } else if (msg.includes('FLOOD') || msg.includes('A wait of')) {
        throw err;  // 让 FloodWait 隔离生效
      } else {
        joinReport.push(`✗ 加群失败「${cand.title}」: ${msg.slice(0, 60)}`);
        continue;
      }
    }
    await ctx.reportProgress?.(Math.round(((i + 1) / toJoin.length) * 100));
    if (i < toJoin.length - 1) {
      // 加群之间间隔 5-15 分钟 (TG 风控线)
      await sleep(gaussianDelayMs(5 * 60_000, 15 * 60_000));
    }
  }

  // 总结写到 logger（agent log 能看到结果，方便排查）
  console.info(`[join_groups_by_keyword] 验证 ${candidates.length} 个候选 → ${verified.length} 合格 → 实际加 ${joined} 个 + 已是 ${alreadyIn} 个。详情:\n  ${joinReport.join('\n  ')}`);

  if (joined === 0 && alreadyIn === 0) {
    throw new Error(`找到 ${verified.length} 个合格候选群但全部加群失败:\n${joinReport.join('\n')}`);
  }
}

// ─── 13/14/15. MEDIA_PHOTO / MEDIA_VIDEO / MEDIA_VOICE ──────────────
/**
 * 媒体发送通用执行器。从素材池随机抽 → 拉文件 → sendFile。
 *
 * payload: {
 *   targetType: 'group' | 'channel' | 'user',
 *   targetId: string,
 *   poolName?: string,        // 优先按 pool 名抽（如 _builtin_voices_casual）
 *   category?: 'photo'|'video'|'voice',  // 否则按分类抽（自动按 task.type 推断）
 *   caption?: string,         // 可选文案
 * }
 */
async function mediaSendImpl(
  ctx: ExecutorCtx,
  defaultCategory: 'photo' | 'video' | 'voice',
): Promise<void> {
  const { targetId, poolName, caption, assetId } = ctx.payload as {
    targetId: string; poolName?: string; caption?: string; assetId?: string;
  };
  const category = (ctx.payload.category as string) ?? defaultCategory;
  if (!targetId) throw new Error('payload.targetId 必填');

  // 任何手机号格式的目标都做 import 预热 (无论内池还是外部陌生人)
  // tryImportContact 幂等: 已是联系人 → no-op; 隐私限制 → 静默
  if (isPhoneFormat(targetId)) {
    await tryImportContact(ctx.client, targetId);
  }

  // 优先 assetId (用户在前端指定了具体素材); 否则按 poolName/category 随机抽
  const asset = assetId
    ? await fetchAssetById(assetId)
    : await pickRandomAsset({ poolName, category, tenantId: ctx.tenantId });
  if (!asset) throw new Error(`没有匹配的素材 (assetId=${assetId ?? '-'}, poolName=${poolName ?? '?'}, category=${category})`);
  await ctx.reportProgress?.(20);

  const buffer = await fetchAssetFile(asset.id);
  if (!buffer) throw new Error(`无法拉取 asset.id=${asset.id} 的文件`);
  await ctx.reportProgress?.(60);

  // 加超时: 防 getEntity / sendFile 永远 hang 住 (例如 TG WebSocket 间歇丢包)
  const entity = await withTimeout(ctx.client.getEntity(targetId), 15_000, 'getEntity 解析目标超时 (对方可能不存在 / 隐私设置不允许 / 网络阻塞)');
  const file = new CustomFile(asset.fileName, buffer.length, '', buffer);

  const sendPromise = defaultCategory === 'voice'
    ? ctx.client.sendFile(entity, { file, voiceNote: true, caption })
    : ctx.client.sendFile(entity, { file, caption, forceDocument: false });
  await withTimeout(sendPromise, 60_000, 'sendFile 上传超时 (>60s, 可能网络问题或 TG 服务波动)');
  await ctx.reportProgress?.(100);
}

export async function mediaPhoto(ctx: ExecutorCtx): Promise<void> { return mediaSendImpl(ctx, 'photo'); }
export async function mediaVideo(ctx: ExecutorCtx): Promise<void> { return mediaSendImpl(ctx, 'video'); }
export async function mediaVoice(ctx: ExecutorCtx): Promise<void> { return mediaSendImpl(ctx, 'voice'); }

// ─── 16/17. CHAT_SCRIPT_AB / CHAT_SCRIPT_4P ─────────────────────────
/**
 * 双角色 / 四角色剧本执行。从 packId 随机抽剧本 → 按 rawScript 跑 turns。
 *
 * 关键设计：每个 turn 的 content_pool 随机抽一个变体（不是固定的 lines[].text），
 * 媒体 turn 通过 asset_pool 名查 builtin pool 拉素材。
 *
 * payload:
 *   chat_script_ab:  { tgChatId, packId?, scriptId?, accountAId, accountBId }
 *   chat_script_4p:  { tgChatId, packId?, scriptId?, accountIds: [4 个] }
 *
 * NOTE: 多账号分工目前由 server 在 task.payload 里指定不同账号 id，
 *       agent 端单 task 只跑一个 role 的 turns（A 或 B）。
 *       完整 N 账号协作需要 server 端 orchestrator 串行下发 N 个 sub-task。
 *       本 executor 是单账号视角：只发 ctx.accountId 对应的 role turns。
 */
async function chatScriptImpl(
  ctx: ExecutorCtx,
  expectedType: 'A+B' | 'A+B+C+D' | 'A+B+C+D+E+F',
): Promise<void> {
  const p = ctx.payload as {
    tgChatId?: string;
    chatMode?: 'private' | 'group';
    accountAId?: string; accountBId?: string; accountCId?: string; accountDId?: string;
    accountEId?: string; accountFId?: string;
    accountAPhone?: string; accountBPhone?: string;
    accountCPhone?: string; accountDPhone?: string;
    packId?: string; scriptId?: string;
  };

  const isGroup = p.chatMode === 'group';

  // 角色 → accountId
  const roleAcc: Record<string, string> = {};
  if (p.accountAId) roleAcc.A = p.accountAId;
  if (p.accountBId) roleAcc.B = p.accountBId;
  if (p.accountCId) roleAcc.C = p.accountCId;
  if (p.accountDId) roleAcc.D = p.accountDId;
  if (p.accountEId) roleAcc.E = p.accountEId;
  if (p.accountFId) roleAcc.F = p.accountFId;
  const rolesPresent = Object.keys(roleAcc);
  if (rolesPresent.length < 2) throw new Error('chat_script 至少需 2 个账号');

  if (!isGroup && (expectedType === 'A+B+C+D' || expectedType === 'A+B+C+D+E+F')) {
    throw new Error('4 人 / 6 人剧本必须用群聊模式 (N×N 私聊太复杂, 暂不支持)');
  }

  // 静默所有参与账号的自动回复（cs 智能客服 / ad FAQ）
  // 让账号专心按剧本说话，即使被 @ 也不会触发自动回复说出剧本之外的话
  const participatingAccountIds = Object.values(roleAcc);
  for (const accId of participatingAccountIds) muteAccount(accId);

  try {
    return await runChatScriptInner(ctx, expectedType, p, roleAcc, rolesPresent, isGroup);
  } finally {
    for (const accId of participatingAccountIds) unmuteAccount(accId);
  }
}

async function runChatScriptInner(
  ctx: ExecutorCtx,
  expectedType: 'A+B' | 'A+B+C+D' | 'A+B+C+D+E+F',
  p: any,
  roleAcc: Record<string, string>,
  rolesPresent: string[],
  isGroup: boolean,
): Promise<void> {
  // 取所有 client (必须都在本 agent 上)
  const clients = ctx.clients;
  if (!clients) throw new Error('chat_script 需要 ctx.clients (本 agent 全部 client map)');
  const roleClient: Record<string, TelegramClient> = {};
  for (const [r, accId] of Object.entries(roleAcc)) {
    const c = clients.get(accId);
    if (!c) throw new Error(`账号 ${accId.slice(0, 8)} (角色 ${r}) 未连接到本 agent`);
    roleClient[r] = c;
  }

  // 抽剧本
  if (p.scriptId) throw new Error('scriptId 暂未实现, 请用 packId 随机抽');
  const script = await pickRandomChatScript({ packId: p.packId, type: expectedType });
  if (!script) throw new Error(`没有匹配的剧本 (packId=${p.packId ?? '*'}, type=${expectedType})`);
  const raw = script.rawScript;
  if (!raw?.sessions?.length) throw new Error(`剧本 ${script.id} 没有 sessions`);

  // 解析每个 role 的 target entity (用各自的 client 来 resolve)
  // 群聊: 所有 role 都发到同一个群
  // 私聊 A+B: A 发给 B 用户, B 发给 A 用户
  const roleTarget: Record<string, any> = {};
  if (isGroup) {
    if (!p.tgChatId) throw new Error('群聊模式需要 tgChatId');
    for (const r of rolesPresent) {
      try {
        roleTarget[r] = await roleClient[r].getEntity(p.tgChatId);
      } catch (err) {
        throw new Error(`角色 ${r} 无法加入群 ${p.tgChatId}: ${(err as Error).message}`);
      }
    }
  } else {
    // 私聊: A↔B 互发
    const aPhone = p.accountAPhone, bPhone = p.accountBPhone;
    if (!aPhone || !bPhone) throw new Error('私聊模式需要 accountAPhone / accountBPhone');
    // A 端 import B → resolve B 实体
    await tryImportContact(roleClient.A, bPhone);
    roleTarget.A = await roleClient.A.getEntity(bPhone);
    // B 端 import A → resolve A 实体
    await tryImportContact(roleClient.B, aPhone);
    roleTarget.B = await roleClient.B.getEntity(aPhone);
  }

  // 走所有 turns
  const allTurns: any[] = [];
  for (const sess of raw.sessions) {
    for (const t of sess.turns ?? []) allTurns.push(t);
  }

  for (let i = 0; i < allTurns.length; i++) {
    const t = allTurns[i];
    const senderClient = roleClient[t.role];
    const targetEntity = roleTarget[t.role];
    if (!senderClient || !targetEntity) continue; // role 不在本任务（比如剧本里有 D 但任务只 A+B）

    // 间隔（剧本里写的 send_delay_sec）
    if (i > 0) {
      const [a, b] = (t.send_delay_sec as [number, number]) ?? [30, 90];
      await sleep(gaussianDelayMs(a * 1000, b * 1000));
    }

    if (t.type === 'voice' && t.asset_pool) {
      const fullPool = t.asset_pool.startsWith('_builtin_') ? t.asset_pool : `_builtin_${t.asset_pool}`;
      const asset = await pickRandomAsset({ poolName: fullPool });
      if (asset) {
        const buf = await fetchAssetFile(asset.id);
        if (buf) {
          const file = new CustomFile(asset.fileName, buf.length, '', buf);
          await senderClient.sendFile(targetEntity, { file, voiceNote: true });
        }
      } else if (t.caption_fallback) {
        await sendMessageLikeHuman(senderClient, targetEntity, t.caption_fallback);
      }
    } else if ((t.type === 'image' || t.type === 'video') && t.asset_pool) {
      const fullPool = t.asset_pool.startsWith('_builtin_') ? t.asset_pool : `_builtin_${t.asset_pool}`;
      const asset = await pickRandomAsset({ poolName: fullPool });
      const captionPool: string[] = t.caption_pool ?? [];
      const caption = captionPool.length
        ? captionPool[Math.floor(Math.random() * captionPool.length)]
        : undefined;
      if (asset) {
        const buf = await fetchAssetFile(asset.id);
        if (buf) {
          const file = new CustomFile(asset.fileName, buf.length, '', buf);
          await senderClient.sendFile(targetEntity, { file, caption });
        }
      } else if (caption) {
        await sendMessageLikeHuman(senderClient, targetEntity, caption);
      }
    } else {
      const pool: string[] = t.content_pool ?? [];
      if (!pool.length) continue;
      const text = pool[Math.floor(Math.random() * pool.length)];
      await sendMessageLikeHuman(senderClient, targetEntity, text);
    }

    await ctx.reportProgress?.(Math.round(((i + 1) / allTurns.length) * 100));
  }
}

/** 简单手机号格式判断: + 可选, 至少 6 位数字 (国码 + 号码) */
function isPhoneFormat(s: string): boolean {
  return /^\+?\d{6,}$/.test(s);
}

/** Promise 超时包装: 到时抛错让 task-runner 标 failed, 不再永远卡 60% */
async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let to: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    to = setTimeout(() => reject(new Error(`${label} (timed out after ${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (to) clearTimeout(to);
  }
}

async function tryImportContact(client: TelegramClient, phone: string): Promise<void> {
  try {
    // 用对方手机号自身作为 firstName, 避免污染联系人列表
    // (之前用 "TeleHubX Peer" 造成 2 个号在 TG 联系人/聊天 header 显示 "TeleHubX Peer")
    await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: BigInt(Date.now()) as any,
            phone,
            firstName: phone,
            lastName: '',
          }),
        ],
      }),
    );
    await sleep(gaussianDelayMs(1_500, 3_500));
  } catch {
    // 已是联系人 / 隐私限制 / FloodWait — 都不阻塞，让下面 getEntity 决定
  }
}

export async function chatScriptAb(ctx: ExecutorCtx): Promise<void> { return chatScriptImpl(ctx, 'A+B'); }
export async function chatScript4p(ctx: ExecutorCtx): Promise<void> { return chatScriptImpl(ctx, 'A+B+C+D'); }
export async function chatScript6p(ctx: ExecutorCtx): Promise<void> { return chatScriptImpl(ctx, 'A+B+C+D+E+F'); }

// ─── 21. GROUP_CREATE ────────────────────────────────────────────────
/**
 * 创建自建测试群 / 大群。
 *
 * payload: {
 *   title: string,
 *   type: 'small' | 'mega',
 *   initialMemberAccountIds?: string[]  // 本租户其他号 UUID
 * }
 *
 * 流程：用 ctx.accountId 当创建者，取本 agent 内其它 client.getMe() 拿 phone，
 * 用 ImportContacts 解析成 InputUser，再 CreateChat / CreateChannel + InviteToChannel。
 */
export async function groupCreate(ctx: ExecutorCtx): Promise<void> {
  const title: string = (ctx.payload.title ?? '').trim();
  const groupType: 'small' | 'mega' = (ctx.payload.type ?? 'small') as any;
  const memberAccIds: string[] = (ctx.payload.initialMemberAccountIds ?? []) as string[];
  if (!title) throw new Error('payload.title 为空');
  if (title.length > 64) throw new Error('群名称超过 64 字');

  // 解析初始成员 → InputUser (用各自 client 拿 phone, 再让 creator import)
  const inputUsers: any[] = [];
  if (memberAccIds.length && ctx.clients) {
    for (const accId of memberAccIds) {
      if (accId === ctx.accountId) continue; // 创建者自己跳过
      const memberClient = ctx.clients.get(accId);
      if (!memberClient) continue; // 不在本 agent 上，跳过
      try {
        const me: any = await memberClient.getMe();
        if (!me?.phone) continue;
        const phone = me.phone.startsWith('+') ? me.phone : `+${me.phone}`;
        const res: any = await ctx.client.invoke(
          new Api.contacts.ImportContacts({
            contacts: [
              new Api.InputPhoneContact({
                clientId: BigInt(Date.now() + inputUsers.length) as any,
                phone,
                firstName: me.firstName ?? phone,
                lastName: me.lastName ?? '',
              }),
            ],
          }),
        );
        const u: any = res.users?.[0];
        if (u) inputUsers.push(new Api.InputUser({ userId: u.id, accessHash: u.accessHash }));
        await sleep(gaussianDelayMs(800, 1_800));
      } catch {
        // 单个成员失败不阻塞整体
      }
    }
  }

  if (groupType === 'small') {
    if (!inputUsers.length) {
      throw new Error('普通群需要至少 1 个初始成员（本池号）');
    }
    await ctx.client.invoke(
      new Api.messages.CreateChat({ users: inputUsers, title }),
    );
  } else {
    const created: any = await ctx.client.invoke(
      new Api.channels.CreateChannel({ title, about: '', megagroup: true }),
    );
    // 从 updates 提取新建频道
    const channel: any = created?.chats?.[0];
    if (!channel) throw new Error('CreateChannel 返回未带 chats');
    if (inputUsers.length) {
      await sleep(gaussianDelayMs(2_000, 4_000));
      await ctx.client.invoke(
        new Api.channels.InviteToChannel({
          channel: new Api.InputChannel({ channelId: channel.id, accessHash: channel.accessHash }),
          users: inputUsers,
        }),
      );
    }
  }

  await ctx.reportProgress?.(100);
}

// ─── 22. GROUP_INVITE_MEMBERS ────────────────────────────────────────
/**
 * 把本池其它账号邀请进已有群。
 *
 * payload: {
 *   tgChatId: string,                // 群 id / @username / 邀请链接
 *   targetAccountIds: string[],      // 本池 account UUID
 * }
 *
 * 一次最多邀请 6 人, Gaussian 间隔。
 */
export async function groupInviteMembers(ctx: ExecutorCtx): Promise<void> {
  const tgChatId: string = (ctx.payload.tgChatId ?? '').trim();
  const targetAccIds: string[] = (ctx.payload.targetAccountIds ?? []) as string[];
  if (!tgChatId) throw new Error('payload.tgChatId 为空');
  if (!targetAccIds.length) throw new Error('payload.targetAccountIds 为空');
  if (!ctx.clients) throw new Error('group_invite_members 需要 ctx.clients');

  const limited = targetAccIds.slice(0, 6);
  const groupEntity: any = await ctx.client.getEntity(tgChatId);
  const isChannel = groupEntity?.megagroup === true || groupEntity?.broadcast === true;

  let done = 0;
  for (let i = 0; i < limited.length; i++) {
    const accId = limited[i];
    if (accId === ctx.accountId) { done++; continue; }
    const memberClient = ctx.clients.get(accId);
    if (!memberClient) continue;
    try {
      const me: any = await memberClient.getMe();
      if (!me?.phone) continue;
      const phone = me.phone.startsWith('+') ? me.phone : `+${me.phone}`;

      // creator 端 import 出 InputUser
      const res: any = await ctx.client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: BigInt(Date.now() + i) as any,
              phone,
              firstName: me.firstName ?? phone,
              lastName: me.lastName ?? '',
            }),
          ],
        }),
      );
      const u: any = res.users?.[0];
      if (!u) continue;
      const inputUser = new Api.InputUser({ userId: u.id, accessHash: u.accessHash });

      if (isChannel) {
        await ctx.client.invoke(
          new Api.channels.InviteToChannel({
            channel: new Api.InputChannel({ channelId: groupEntity.id, accessHash: groupEntity.accessHash }),
            users: [inputUser],
          }),
        );
      } else {
        await ctx.client.invoke(
          new Api.messages.AddChatUser({
            chatId: groupEntity.id,
            userId: inputUser,
            fwdLimit: 50,
          }),
        );
      }
      done++;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.includes('USER_PRIVACY_RESTRICTED') ||
        msg.includes('USER_NOT_MUTUAL_CONTACT') ||
        msg.includes('PEER_ID_INVALID') ||
        msg.includes('USER_ALREADY_PARTICIPANT')
      ) {
        // 静默跳过
      } else {
        throw err;
      }
    }

    await ctx.reportProgress?.(Math.round(((i + 1) / limited.length) * 100));
    if (i < limited.length - 1) {
      await sleep(gaussianDelayMs(20_000, 60_000));
    }
  }

  if (done === 0) throw new Error('一个成员都没邀请进去（可能全部隐私限制 / 已在群里）');
}

// ─── 24. DISCOVER_GROUPS_BY_KEYWORD ─────────────────────────────────
/**
 * 关键词搜群 + 评估质量 → 写入 discovered_groups 池。**不加群、不爬群**。
 * 租户在 dashboard /discovered-groups 里人工挑选高质量群 → 触发现有 join + scrape。
 *
 * payload: {
 *   keywords: string[],
 *   minMembers?: 50,
 *   sampleSize?: 100  // 抽样多少条历史评估发言者
 * }
 */
export async function discoverGroupsByKeyword(ctx: ExecutorCtx): Promise<void> {
  const keywords: string[] = (ctx.payload.keywords ?? []) as string[];
  const minMembers: number = (ctx.payload.minMembers as number) ?? 50;
  const sampleSize: number = Math.min(200, Math.max(20, (ctx.payload.sampleSize as number) ?? 100));
  if (!keywords.length) throw new Error('payload.keywords 不能为空');
  if (!ctx.tenantId) throw new Error('ctx.tenantId 缺失（无法落库 discovered_groups）');

  const discovered: DiscoveredGroupUpsertItem[] = [];
  const seenChatIds = new Set<string>();

  for (const kw of keywords) {
    let res: any;
    try {
      res = await ctx.client.invoke(new Api.contacts.Search({ q: kw.trim(), limit: 30 }));
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('FLOOD')) throw err;
      continue;
    }
    const chats = res?.chats ?? [];

    for (const c of chats) {
      const chatId = String(c.id ?? '');
      if (!chatId || seenChatIds.has(chatId)) continue;
      if (c.deactivated || c.kicked) continue;

      const isMega = c.megagroup === true;
      const isBasic = c.className === 'Chat';
      const isBroadcast = c.broadcast === true;
      let kind: 'mega' | 'channel' | 'basic' | 'gigagroup' | null = null;
      if (c.gigagroup === true) kind = 'gigagroup';
      else if (isMega) kind = 'mega';
      else if (isBasic) kind = 'basic';
      else if (isBroadcast) kind = 'channel';
      if (!kind) continue;

      seenChatIds.add(chatId);

      // 真实成员数 + isGigagroup（GetFullChannel）
      let participantsCount: number = (c.participantsCount as number) ?? -1;
      let isGigagroup = (c.gigagroup === true);
      if (kind !== 'basic' && participantsCount < 0) {
        try {
          const full: any = await ctx.client.invoke(new Api.channels.GetFullChannel({ channel: c }));
          participantsCount = (full?.fullChat?.participantsCount as number) ?? participantsCount;
          isGigagroup = isGigagroup || (full?.chats?.[0]?.gigagroup === true);
        } catch {
          // 拿不到就当不知道
        }
        await sleep(gaussianDelayMs(800, 1800));
      }

      // 抽样历史消息：是否有真用户发言（identifies announcement-only / spam）
      let hasRealSenders = false;
      let sampledMessages = 0;
      let sampledRealSenders = 0;
      // 必须能取到 entity 才能 getMessages；contacts.Search 返回的 chat 通常足够
      try {
        const msgs: any = await ctx.client.getMessages(c, { limit: sampleSize });
        sampledMessages = (msgs as any[]).length;
        const realSenderIds = new Set<string>();
        for (const m of msgs as any[]) {
          const fromId = m.fromId;
          if (fromId?.className === 'PeerUser') {
            realSenderIds.add(String(fromId.userId));
          }
        }
        sampledRealSenders = realSenderIds.size;
        hasRealSenders = sampledRealSenders > 0;
      } catch {
        // 抽样失败不致命，继续
      }
      await sleep(gaussianDelayMs(800, 1800));

      // 跳过明显不合格（成员太少 + 不是 basic）
      if (participantsCount > 0 && participantsCount < minMembers) continue;

      discovered.push({
        tgChatId: chatId,
        tgUsername: (c.username as string) ?? null,
        title: c.title ?? '',
        kind,
        participantsCount,
        isGigagroup,
        hasRealSenders,
        sampledMessages,
        sampledRealSenders,
        keyword: kw,
        discoveredByAccountId: ctx.accountId ?? null,
        discoverTaskId: ctx.taskId ?? null,
      });
    }

    // 关键词之间隔
    await sleep(gaussianDelayMs(3_000, 8_000));
  }

  if (!discovered.length) {
    throw new Error(`关键词 [${keywords.join(', ')}] 没找到任何匹配群组`);
  }

  const result = await bulkUpsertDiscoveredGroups(ctx.tenantId, discovered);
  if (!result) throw new Error('bulkUpsertDiscoveredGroups 失败（server 不可达？）');

  console.info(
    `[discover_groups_by_keyword] 关键词=${keywords.join('|')} ` +
    `搜出=${discovered.length} 个群 → 入库 inserted=${result.inserted} updated=${result.updated}`,
  );
  await ctx.reportProgress?.(100);
}

// ─── 22. SELF_TEST ────────────────────────────────────────────────────
/**
 * 账号自检 — 跑 6 个轻量 RPC 探针验证账号 + client + 网络全链路。
 * 无副作用：只读 + 修改在线状态（与正常 keepalive 一致）。
 *
 * 结果写入 errorMsg 字段（JSON 格式），前端读出并展示每项 ✓/✗。
 *
 * 失败定义：6 项中任何一项 throw（含超时） → 整任务标 failed，errorMsg 仍是完整结果 JSON。
 */
export async function selfTest(ctx: ExecutorCtx): Promise<void> {
  const checks: Array<{
    name: string;
    label: string;
    fn: () => Promise<unknown>;
  }> = [
    {
      name: 'getMe',
      label: '账号身份验证 (getMe)',
      fn: () => ctx.client.getMe(),
    },
    {
      name: 'updateStatus',
      label: '在线状态更新 (account.UpdateStatus)',
      fn: () => ctx.client.invoke(new Api.account.UpdateStatus({ offline: false })),
    },
    {
      name: 'getDialogs',
      label: '对话列表读取 (messages.GetDialogs)',
      fn: () => ctx.client.getDialogs({ limit: 1 }),
    },
    {
      name: 'getEntity',
      label: '解析公开实体 (getEntity @telegram)',
      fn: () => ctx.client.getEntity('telegram'),
    },
    {
      name: 'getMessages',
      label: '读取频道消息 (getMessages @telegram limit=5)',
      fn: async () => {
        const ent = await ctx.client.getEntity('telegram');
        return ctx.client.getMessages(ent, { limit: 5 });
      },
    },
    {
      name: 'contactsSearch',
      label: '关键词搜索 (contacts.Search) — 这是 #88 卡死的同款 RPC',
      fn: () =>
        ctx.client.invoke(
          new Api.contacts.Search({ q: 'telegram', limit: 5 }),
        ),
    },
  ];

  const results: Array<{
    name: string;
    label: string;
    ok: boolean;
    durationMs: number;
    error?: string;
  }> = [];

  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const t0 = Date.now();
    try {
      // 单项 30s 上限 (比全局 60s 严, 因为 self-test 应该快)
      await Promise.race([
        c.fn(),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`self-test 检查超时 (>30s)`)), 30_000),
        ),
      ]);
      results.push({ name: c.name, label: c.label, ok: true, durationMs: Date.now() - t0 });
    } catch (err: any) {
      results.push({
        name: c.name,
        label: c.label,
        ok: false,
        durationMs: Date.now() - t0,
        error: (err?.message ?? String(err)).slice(0, 200),
      });
    }
    await ctx.reportProgress?.(Math.round(((i + 1) / checks.length) * 100));
  }

  const failed = results.filter((r) => !r.ok);
  const summary = JSON.stringify({ results, passed: results.length - failed.length, failed: failed.length });

  if (failed.length > 0) {
    // 通过 throw 让 task 标 failed, 但带上完整结果 JSON
    throw new Error(summary);
  }
  // 全部通过 — 把结果 JSON 暂存到 progress field？不行，progress 是 int。
  // 用 throw 方式只在失败时触发，全成功时把结果存进 errorMsg 也合理（虽然名字叫 errorMsg）
  // 折中：成功时通过 reportProgress 完成（100），结果存到 errorMsg 字段（用 markDone 后由 server 读 task 详情）
  // 但 markDone 会清 errorMsg... 先 PATCH errorMsg, 再让 markDone 触发
  // 最简单方案：成功也走 throw, 但 server 端识别到 SELF_TEST 类型时不当真 failed
  // 这里用 throw 统一处理 — server 看 errorMsg 是 JSON 即认定 self-test 完成
  throw new Error(summary);
}

// ─── Dispatcher ─────────────────────────────────────────────────────
export const EXECUTORS: Record<string, (ctx: ExecutorCtx) => Promise<void>> = {
  self_test:       selfTest,
  idle_keepalive:  idleKeepalive,
  join_channels:   joinChannels,
  browse_channel:  browseChannel,
  reaction_boost:  reactionBoost,
  group_bubble:    groupBubble,
  join_groups:     joinGroups,
  accept_invites:  acceptInvites,
  profile_update:  profileUpdate,
  post_channel:    postChannel,
  group_scrape:    groupScrape,
  contact_add:     contactAdd,
  campaign_single: campaignSingle,
  media_photo:     mediaPhoto,
  media_video:     mediaVideo,
  media_voice:     mediaVoice,
  chat_script_ab:  chatScriptAb,
  chat_script_4p:  chatScript4p,
  chat_script_6p:  chatScript6p,
  join_groups_by_keyword: joinGroupsByKeyword,
  discover_groups_by_keyword: discoverGroupsByKeyword,
  group_create:    groupCreate,
  group_invite_members: groupInviteMembers,
};
