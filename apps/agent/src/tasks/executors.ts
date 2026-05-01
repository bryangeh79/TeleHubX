import { Api, type TelegramClient } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import { gaussianDelayMs, sendMessageLikeHuman, simulateReading, sleep } from './behavior-simulator';
import {
  bulkUpsertCandidates,
  fetchAssetById,
  fetchAssetFile,
  markCandidateContacted,
  pickRandomAsset,
  pickRandomChatScript,
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
  const channels: string[] = ctx.payload.channels ?? [];
  const [minSec, maxSec] = (ctx.payload.readDurationSec as [number, number]) ?? [20, 90];
  if (!channels.length) throw new Error('payload.channels 为空');

  for (let i = 0; i < channels.length; i++) {
    const target = channels[i].trim().replace(/^@/, '').replace(/^https:\/\/t\.me\//, '');
    const entity = await ctx.client.getEntity(target);
    // getHistory 拉前 20 条 — TG 后台看到这就是"打开聊天"
    await ctx.client.getMessages(entity, { limit: 20 });
    // 停留模拟阅读
    await simulateReading(minSec, maxSec);
    await ctx.reportProgress?.(Math.round(((i + 1) / channels.length) * 100));
  }
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

  const entity = await ctx.client.getEntity(tgChatId);
  const recent = await ctx.client.getMessages(entity, { limit: 50 });
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
  const chatIds: string[] = (ctx.payload.tgChatIds ?? []) as string[];
  const maxPer = (ctx.payload.maxScrapePerGroup as number) ?? 50;
  if (!chatIds.length) throw new Error('payload.tgChatIds 为空');
  if (!ctx.tenantId) throw new Error('ctx.tenantId 缺失（爬完无法落库）');

  const cutoff = Date.now() / 1000 - 30 * 86400; // 30 天活跃过的才要

  let totalInserted = 0;
  for (let i = 0; i < chatIds.length; i++) {
    const chatId = chatIds[i].trim();
    try {
      const entity = await ctx.client.getEntity(chatId);
      const participants = await ctx.client.getParticipants(entity, {
        limit: 200,
      });

      const items: any[] = [];
      for (const p of participants) {
        const u: any = p;
        // 只要真人：非 bot, 非已删除, 30 天内活跃过
        if (u.bot || u.deleted) continue;
        const lastSeenSec = (u.status?.wasOnline as number | undefined) ?? null;
        if (lastSeenSec !== null && lastSeenSec < cutoff) continue;
        items.push({
          tgUserId: String(u.id),
          tgUsername: u.username ?? null,
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          sourceGroupId: chatId,
          scrapedByAccountId: ctx.accountId ?? null,
          priorityScore: 50 + (u.username ? 10 : 0) + (u.photo ? 5 : 0),
        });
        if (items.length >= maxPer) break;
      }

      if (items.length) {
        const result = await bulkUpsertCandidates(ctx.tenantId, items);
        totalInserted += result?.inserted ?? 0;
      }
    } catch (err) {
      // 单个群失败不中断整个任务
      const msg = (err as Error).message ?? '';
      if (!msg.includes('CHAT_ADMIN_REQUIRED') && !msg.includes('PARTICIPANTS_FORBIDDEN')) {
        throw err;
      }
    }

    await ctx.reportProgress?.(Math.round(((i + 1) / chatIds.length) * 100));
    if (i < chatIds.length - 1) {
      // 群之间间隔 10-30 分钟（防 ban）
      await sleep(gaussianDelayMs(10 * 60_000, 30 * 60_000));
    }
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
export async function campaignSingle(ctx: ExecutorCtx): Promise<void> {
  const rawTargets = (ctx.payload.targets ?? []) as any[];
  const variants: string[] = (ctx.payload.variants ?? []) as string[];
  const [minSec, maxSec] = (ctx.payload.intervalSec as [number, number]) ?? [60, 300];

  if (!rawTargets.length) throw new Error('payload.targets 为空');
  if (!variants.length) throw new Error('payload.variants 为空');

  for (let i = 0; i < rawTargets.length; i++) {
    const raw = rawTargets[i];
    const target = typeof raw === 'string' ? { username: raw } : raw;
    const handle = (target.username ?? '').replace(/^@/, '');
    if (!handle) continue;

    try {
      const entity = await ctx.client.getEntity(handle);
      const variant = variants[Math.floor(Math.random() * variants.length)];
      await sendMessageLikeHuman(ctx.client, entity, variant);

      if (target.candidateId && ctx.accountId) {
        await markCandidateContacted(target.candidateId, ctx.accountId, ctx.taskId);
      }
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (
        msg.includes('USER_PRIVACY_RESTRICTED') ||
        msg.includes('PEER_ID_INVALID') ||
        msg.includes('USERNAME_NOT_OCCUPIED')
      ) {
        // 跳过
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
  expectedType: 'A+B' | 'A+B+C+D',
): Promise<void> {
  const p = ctx.payload as {
    tgChatId?: string;
    chatMode?: 'private' | 'group';
    accountAId?: string; accountBId?: string; accountCId?: string; accountDId?: string;
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
  const rolesPresent = Object.keys(roleAcc);
  if (rolesPresent.length < 2) throw new Error('chat_script 至少需 2 个账号');

  if (!isGroup && expectedType === 'A+B+C+D') {
    throw new Error('4 人剧本必须用群聊模式 (4 人 N×N 私聊太复杂, 暂不支持)');
  }

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

// ─── Dispatcher ─────────────────────────────────────────────────────
export const EXECUTORS: Record<string, (ctx: ExecutorCtx) => Promise<void>> = {
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
};
