import { Api, type TelegramClient } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import { gaussianDelayMs, sendMessageLikeHuman, simulateReading, sleep } from './behavior-simulator';
import {
  bulkUpsertCandidates,
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
  const { channelId, content, mediaPath } = ctx.payload as {
    channelId: string; content: string; mediaPath?: string;
  };
  if (!channelId) throw new Error('payload.channelId 必填');
  if (!content && !mediaPath) throw new Error('payload.content 或 mediaPath 至少一个');

  const entity = await ctx.client.getEntity(channelId);
  await ctx.reportProgress?.(20);

  if (mediaPath) {
    await ctx.client.sendFile(entity, {
      file: mediaPath,
      caption: content,
      forceDocument: false,
    });
  } else {
    await sendMessageLikeHuman(ctx.client, entity, content);
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
  const { targetId, poolName, caption } = ctx.payload as {
    targetId: string; poolName?: string; caption?: string;
  };
  const category = (ctx.payload.category as string) ?? defaultCategory;
  if (!targetId) throw new Error('payload.targetId 必填');

  const asset = await pickRandomAsset({
    poolName,
    category,
    tenantId: ctx.tenantId,
  });
  if (!asset) throw new Error(`没有匹配的素材 (poolName=${poolName ?? '?'}, category=${category})`);
  await ctx.reportProgress?.(20);

  const buffer = await fetchAssetFile(asset.id);
  if (!buffer) throw new Error(`无法拉取 asset.id=${asset.id} 的文件`);
  await ctx.reportProgress?.(60);

  const entity = await ctx.client.getEntity(targetId);
  const file = new CustomFile(asset.fileName, buffer.length, '', buffer);

  // voice 走单独路径（强制 voice attribute 让 TG 显示语音条而不是音频文件）
  if (defaultCategory === 'voice') {
    await ctx.client.sendFile(entity, {
      file,
      voiceNote: true,
      caption,
    });
  } else {
    await ctx.client.sendFile(entity, {
      file,
      caption,
      forceDocument: false,
    });
  }
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
  const { tgChatId, targetPhoneNumber, packId, scriptId, chatMode } = ctx.payload as {
    tgChatId?: string; targetPhoneNumber?: string;
    packId?: string; scriptId?: string;
    chatMode?: 'private' | 'group';
  };
  // 群聊：tgChatId 必填；私聊：targetPhoneNumber 必填
  const target = tgChatId ?? targetPhoneNumber;
  if (!target) throw new Error('chat_script: 群聊需 tgChatId / 私聊需 targetPhoneNumber');

  // 角色映射：哪个 accountId 对应哪个 role label
  // 简化：任务 payload 里直接传 myRole（'A'/'B'/'C'/'D'）
  const myRole = (ctx.payload.myRole as 'A'|'B'|'C'|'D') ?? 'A';

  let script: any;
  if (scriptId) {
    // 显式指定 scriptId → 后续可加 GET /chat-scripts/:id 单独调（暂不实现）
    throw new Error('scriptId 显式指定暂未实现，请用 packId 随机抽');
  } else {
    script = await pickRandomChatScript({ packId, type: expectedType });
    if (!script) throw new Error(`没有匹配的剧本 (packId=${packId ?? '*'}, type=${expectedType})`);
  }

  const raw = script.rawScript;
  if (!raw?.sessions?.length) {
    throw new Error(`剧本 ${script.id} 没有 rawScript.sessions[]`);
  }

  // 私聊前置：自动把对方手机号 import 为联系人。
  // - 已经是联系人 / 对方已被添加：TG 直接当 no-op，不报错
  // - 对方手机号隐私设为「无人可见」：ImportContacts 返回空 users[]，下面
  //   getEntity 会抛 PEER_ID_INVALID，executor 会被外层标记 failed 并清晰报错
  if (targetPhoneNumber && !tgChatId) {
    try {
      await ctx.client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: BigInt(Date.now()) as any,
              phone: targetPhoneNumber,
              firstName: 'TeleHubX',
              lastName: 'Peer',
            }),
          ],
        }),
      );
      // 给 TG 服务器一点时间把 contact 同步进来
      await sleep(gaussianDelayMs(2_000, 5_000));
    } catch {
      // FloodWait / 隐私限制 / 已存在 — 都不阻塞，让下面 getEntity 决定
    }
  }

  const entity = await ctx.client.getEntity(target);
  const allTurns: any[] = [];
  for (const sess of raw.sessions) {
    for (const t of sess.turns ?? []) allTurns.push(t);
  }

  // 只跑 myRole 的回合
  const myTurns = allTurns.filter((t) => t.role === myRole);
  if (!myTurns.length) {
    // 这个 role 没回合，直接结束
    await ctx.reportProgress?.(100);
    return;
  }

  for (let i = 0; i < myTurns.length; i++) {
    const t = myTurns[i];

    // 等到 turn 起点（用 send_delay_sec 累加近似，不与其他 role 真正同步 — 简化版）
    if (i > 0) {
      const [a, b] = (t.send_delay_sec as [number, number]) ?? [30, 90];
      await sleep(gaussianDelayMs(a * 1000, b * 1000));
    }

    if (t.type === 'voice' && t.asset_pool) {
      // 语音 turn：按 asset_pool 名查 _builtin_voices_<pool>
      const fullPool = t.asset_pool.startsWith('_builtin_') ? t.asset_pool : `_builtin_${t.asset_pool}`;
      const asset = await pickRandomAsset({ poolName: fullPool });
      if (asset) {
        const buf = await fetchAssetFile(asset.id);
        if (buf) {
          const file = new CustomFile(asset.fileName, buf.length, '', buf);
          await ctx.client.sendFile(entity, { file, voiceNote: true });
        }
      } else if (t.caption_fallback) {
        // 找不到素材 → 用文字兜底
        await sendMessageLikeHuman(ctx.client, entity, t.caption_fallback);
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
          await ctx.client.sendFile(entity, { file, caption });
        }
      } else if (caption) {
        await sendMessageLikeHuman(ctx.client, entity, caption);
      }
    } else {
      // 文本 turn：从 content_pool 随机抽变体
      const pool: string[] = t.content_pool ?? [];
      if (!pool.length) continue;
      const text = pool[Math.floor(Math.random() * pool.length)];
      await sendMessageLikeHuman(ctx.client, entity, text);
    }

    await ctx.reportProgress?.(Math.round(((i + 1) / myTurns.length) * 100));
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
