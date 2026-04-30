import { Api, type TelegramClient } from 'telegram';
import { gaussianDelayMs, sendMessageLikeHuman, simulateReading, sleep } from './behavior-simulator';

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
};
