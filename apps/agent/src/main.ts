import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { logger } from './logger';
import { registerSignalHandlers, onShutdown } from './shutdown';
import { ConnectionManager } from './telegram/telegram-client.service';
import { attachMessageHandler } from './telegram/message-handler';
import { attachGroupLeadCollector, groupLeadCollector } from './telegram/group-lead-collector';
import { KeepOnlineService } from './telegram/keeponline';
import { AiReplyService } from './ai/ai-reply.service';

// ───────────────────────────────────────────────────────────────────────────
// DB-driven multi-account agent.
//
// On boot it asks the server for every account with sessionEncrypted=true,
// fetches each session via /accounts/:id/session/raw, and connects them
// over GramJS using the platform's TG_API_ID / TG_API_HASH. Then a poll
// loop every POLL_INTERVAL_MS:
//   - picks up newly-bound accounts (BindWizard / CSV import)
//   - drops accounts that were deleted from the dashboard
//   - sends /accounts/:id/heartbeat for every connected account so the
//     dashboard's status column reflects reality instead of stale 'offline'
//
// The legacy single-account .env path (TG_PHONE / TG_SESSION / ACCOUNT_ID)
// is gone — DB is now the source of truth. TG_API_ID / TG_API_HASH stay
// in .env because they're platform-level credentials.
// ───────────────────────────────────────────────────────────────────────────

interface ApiAccount {
  id: string;
  phoneNumber: string;
  role: 'cs' | 'ad' | 'hybrid';
  sessionEncrypted: boolean;
  proxyConfig?: { host: string; port: number; username?: string; password?: string } | null;
  proxyId?: string | null;
  deviceFingerprint?: {
    deviceModel: string;
    systemVersion: string;
    appVersion: string;
    langCode: string;
    systemLangCode: string;
  } | null;
  tgUserId?: string | null;
}

const FALLBACK_FINGERPRINT = {
  deviceModel: 'Samsung SM-S928B',
  systemVersion: 'Android 14',
  appVersion: '10.14.2',
  langCode: 'en',
  systemLangCode: 'en',
};

interface ApiProxy {
  id: string;
  type: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  status: string;
}

interface ConnectedSlot {
  client: import('telegram').TelegramClient;
  keepOnline: KeepOnlineService;
  role: ApiAccount['role'];
}

const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:9800').replace(/\/$/, '');
const API_BASE = `${SERVER_URL}/api/v1`;
const POLL_INTERVAL_MS = parseInt(process.env.AGENT_POLL_INTERVAL_MS ?? '30000', 10);
const HEARTBEAT_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 10_000;
const AGENT_TOKEN = process.env.AGENT_TOKEN ?? '';
if (!AGENT_TOKEN) {
  logger.warn('AGENT_TOKEN missing in env — server will reject agent callbacks. Set AGENT_TOKEN to match server.');
}
const AGENT_AUTH_HEADER: Record<string, string> = AGENT_TOKEN
  ? { 'X-Agent-Token': AGENT_TOKEN }
  : {};

registerSignalHandlers();

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...AGENT_AUTH_HEADER,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} on ${path}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function patchJson<T = any>(path: string, body: any): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEARTBEAT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...AGENT_AUTH_HEADER },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function postNoBody(path: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEARTBEAT_TIMEOUT_MS);
  try {
    await fetch(`${API_BASE}${path}`, { method: 'POST', headers: AGENT_AUTH_HEADER, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function bootstrap(): Promise<void> {
  const apiId = parseInt(process.env.TG_API_ID ?? '0', 10);
  const apiHash = process.env.TG_API_HASH ?? '';
  if (!apiId || !apiHash) {
    logger.error('TG_API_ID / TG_API_HASH missing in .env — agent cannot start');
    return;
  }

  const manager = new ConnectionManager();
  const slots = new Map<string, ConnectedSlot>(); // accountId → connected resources

  // 「自己人白名单」: 本实例所有已绑账号的 TG 数字 user id 集合。
  // AutoReplyDecider 收到消息时, 如果 msg.fromId 落在这里就跳过自动回复,
  // 防止 chat_script 让两个本租户账号互相 FAQ-loop.
  const ownNetwork = new Set<string>();
  const getOwnNetwork = () => ownNetwork;

  // 启动时拿默认 tenant id（被动群监听采集到的 lead 入库需要 tenantId）。
  // 当前系统单租户，后续多租户时需扩展为 per-account.tenantId。
  let defaultTenantId: string | null = null;
  try {
    const t = await fetchJson<{ id: string }>('/tenants/default').catch(() => null);
    defaultTenantId = t?.id ?? null;
    if (defaultTenantId) {
      logger.info(`[bootstrap] defaultTenantId=${defaultTenantId.slice(0, 8)} (passive group-lead-collector enabled)`);
      groupLeadCollector.start();
    } else {
      logger.warn(`[bootstrap] /tenants/default returned null, group-lead-collector disabled`);
    }
  } catch (err) {
    logger.warn(`[bootstrap] failed to fetch default tenant: ${(err as Error).message}`);
  }

  // 广告号话术动态配置（从 server platform_settings 拉取，每 30s 刷新）
  const adFaqConfig = {
    groupFaq: process.env.AD_GROUP_FAQ_REPLY ?? 'For more details please DM our bot!',
    privateDivert: process.env.AD_PRIVATE_DIVERT_MSG ?? 'Hi! For assistance please contact our team via our official bot.',
  };
  async function syncAdFaqConfig() {
    try {
      const res = await fetch(`${API_BASE}/platform-config/ai/settings/ad-faq`, {
        headers: AGENT_AUTH_HEADER,
      });
      if (res.ok) {
        const data = await res.json() as { groupFaq: string; privateDivert: string };
        adFaqConfig.groupFaq = data.groupFaq ?? adFaqConfig.groupFaq;
        adFaqConfig.privateDivert = data.privateDivert ?? adFaqConfig.privateDivert;
      }
    } catch {
      // 静默失败，保持上次的值
    }
  }
  // 启动时立即拉一次
  void syncAdFaqConfig();

  // Optional CS-role AI reply (shared across all cs accounts)
  let aiReplyService: AiReplyService | undefined;
  if (process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY) {
    aiReplyService = new AiReplyService({
      provider: (process.env.AI_PROVIDER ?? 'openai') as AiReplyService['config']['provider'],
      apiKey:
        process.env.AI_API_KEY ??
        process.env.OPENAI_API_KEY ??
        process.env.DEEPSEEK_API_KEY ??
        '',
      baseUrl: process.env.AI_BASE_URL,
      model: process.env.AI_MODEL,
      systemPrompt: process.env.AI_SYSTEM_PROMPT,
      tenantName: process.env.TENANT_NAME ?? 'TeleHubX',
      botName: process.env.BOT_USERNAME ?? 'your_bot',
    });
    logger.info(`[AI] Reply service initialized (provider=${process.env.AI_PROVIDER ?? 'openai'})`);
  }

  async function resolveProxy(account: ApiAccount): Promise<ConnectedSlot extends never ? never : import('./telegram/telegram-client.factory').ProxyConfig | undefined> {
    // 老路径：proxyConfig 内联在 account 上（legacy）。直接当 SOCKS5 用。
    if (account.proxyConfig?.host && account.proxyConfig.port) {
      return {
        ip: account.proxyConfig.host,
        port: account.proxyConfig.port,
        socksType: 5 as const,
        username: account.proxyConfig.username,
        password: account.proxyConfig.password,
      };
    }
    // 新路径：通过 server 的 /proxies/:id/gram-config 拿"即插即用"描述符。
    // server 会自动处理 HTTP→SOCKS5 桥接（HttpToSocks5Bridge 在 server 进程跑），
    // 返回的可能是远端 SOCKS5 凭证，也可能是 127.0.0.1:bridge_port。
    if (account.proxyId) {
      try {
        const cfg = await fetchJson<{
          ip: string; port: number; socksType: 4 | 5;
          username?: string; password?: string;
        } | null>(`/proxies/${account.proxyId}/gram-config`);
        if (cfg && cfg.ip && cfg.port) {
          return {
            ip: cfg.ip,
            port: cfg.port,
            socksType: cfg.socksType,
            username: cfg.username,
            password: cfg.password,
          };
        }
        logger.warn(`[proxy] ${account.proxyId.slice(0, 8)}: server returned null gram-config`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[proxy] failed to load ${account.proxyId.slice(0, 8)}: ${msg}`);
      }
    }
    return undefined;
  }

  async function connect(account: ApiAccount): Promise<void> {
    if (slots.has(account.id)) return;

    let session: string;
    try {
      const r = await fetchJson<{ session: string }>(`/accounts/${account.id}/session/raw`);
      session = r.session ?? '';
    } catch (err: unknown) {
      logger.error(`[connect] ${account.id.slice(0, 8)} session fetch failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!session) {
      logger.warn(`[connect] ${account.id.slice(0, 8)} has empty session — skipping`);
      return;
    }

    const proxy = await resolveProxy(account);

    let client: import('telegram').TelegramClient;
    try {
      client = await manager.addAccount(account.id, {
        phoneNumber: account.phoneNumber,
        sessionString: session,
        apiId,
        apiHash,
        proxy,
        deviceFingerprint: account.deviceFingerprint ?? FALLBACK_FINGERPRINT,
      });
    } catch (err: unknown) {
      logger.error(`[connect] ${account.id.slice(0, 8)} addAccount failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    attachMessageHandler(client, {
      role: account.role,
      accountId: account.id,
      selfTgUserId: account.tgUserId ?? null,
      botUsername: process.env.BOT_USERNAME ?? 'your_bot',
      // getter 模式：每次消息到来时读取最新话术，无需重启 agent
      adGroupFaqReply: () => adFaqConfig.groupFaq,
      adPrivateDivertMsg: () => adFaqConfig.privateDivert,
      aiReplyService: account.role === 'cs' ? aiReplyService : undefined,
      getOwnNetwork,
    });

    // 被动群线索采集（D 方案）：所有账号挂监听，群里有人发言就收集为候选 lead
    if (defaultTenantId) {
      attachGroupLeadCollector(client, {
        accountId: account.id,
        tenantId: defaultTenantId,
        selfTgUserId: account.tgUserId ?? null,
        getOwnNetwork,
      });
    }

    const keepOnline = new KeepOnlineService();
    keepOnline.start(client);

    slots.set(account.id, { client, keepOnline, role: account.role });
    logger.info(`[connect] ${account.id.slice(0, 8)} role=${account.role} phone=${account.phoneNumber} proxy=${proxy ? proxy.ip + ':' + proxy.port : '(direct)'} ✓`);

    // 懒迁移: tgUserId 为空就 getMe() 回填 + 加进白名单
    if (!account.tgUserId) {
      try {
        const me = await client.getMe();
        const tgUserId = String((me as any)?.id ?? '');
        if (tgUserId) {
          ownNetwork.add(tgUserId);
          await patchJson(`/accounts/${account.id}`, { tgUserId }).catch(() => {});
          logger.info(`[connect] ${account.id.slice(0, 8)} backfilled tgUserId=${tgUserId}`);
        }
      } catch (err: unknown) {
        logger.warn(`[connect] ${account.id.slice(0, 8)} getMe failed: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      ownNetwork.add(account.tgUserId);
    }
  }

  async function disconnect(accountId: string): Promise<void> {
    const slot = slots.get(accountId);
    if (!slot) return;
    slot.keepOnline.stop();
    await manager.removeAccount(accountId).catch(() => {});
    slots.delete(accountId);
    logger.info(`[disconnect] ${accountId.slice(0, 8)} ✓`);
  }

  async function syncFromDb(): Promise<void> {
    let accounts: ApiAccount[];
    try {
      accounts = await fetchJson<ApiAccount[]>('/accounts');
    } catch (err: unknown) {
      logger.warn(`[sync] /accounts unreachable: ${err instanceof Error ? err.message : err}`);
      return;
    }

    const wantConnected = accounts.filter((a) => a.sessionEncrypted);
    const dbIds = new Set(wantConnected.map((a) => a.id));

    // 重建 ownNetwork: 把所有已知 tgUserId 收进来 (新连的会在 connect() 里再加)
    ownNetwork.clear();
    for (const a of accounts) {
      if (a.tgUserId) ownNetwork.add(a.tgUserId);
    }

    // Connect newcomers
    for (const a of wantConnected) {
      if (!slots.has(a.id)) {
        await connect(a);
      }
    }

    // Drop departed
    for (const id of [...slots.keys()]) {
      if (!dbIds.has(id)) {
        await disconnect(id);
      }
    }

    // Heartbeat: tell server we're online for each connected account
    for (const id of slots.keys()) {
      try {
        await postNoBody(`/accounts/${id}/heartbeat`);
      } catch (err: unknown) {
        // non-fatal — server may briefly be unavailable; next tick retries
        logger.warn(`[heartbeat] ${id.slice(0, 8)} ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Initial sync (block boot until first attempt; subsequent are fire-and-forget)
  await syncFromDb();
  logger.info(`Initial sync complete — ${slots.size} account(s) connected`);

  const pollTimer = setInterval(() => {
    void syncFromDb();
    void syncAdFaqConfig(); // 每 30s 同时刷新广告话术
  }, POLL_INTERVAL_MS);

  // ── Task dispatcher ────────────────────────────────────────────────────
  const TASK_POLL_INTERVAL_MS = parseInt(process.env.TASK_POLL_INTERVAL_MS ?? '15000', 10);
  const taskCallbacks = {
    updateProgress: (id: string, pct: number) =>
      patchJson(`/tasks/${id}`, { progress: pct }).catch(() => {}),
    markDone: (id: string) =>
      patchJson(`/tasks/${id}`, { status: 'done', progress: 100 }).catch(() => {}),
    markFailed: (id: string, errorMsg: string) =>
      patchJson(`/tasks/${id}`, { status: 'failed', errorMsg }).catch(() => {}),
    quarantineAccount: async (accountId: string, untilEpochMs: number, reason: string) => {
      try {
        await patchJson(`/accounts/${accountId}`, {
          quarantineUntil: new Date(untilEpochMs).toISOString(),
          quarantineReason: reason,
          status: 'error',
        });
      } catch {}
    },
    log: { info: (m: string) => logger.info(m), warn: (m: string) => logger.warn(m), error: (m: string) => logger.error(m) },
  };

  async function dispatchTasks(): Promise<void> {
    const accountIds = [...slots.keys()];
    if (!accountIds.length) return;
    let dispatched: any[] = [];
    try {
      const res = await fetch(`${API_BASE}/tasks/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AGENT_AUTH_HEADER },
        body: JSON.stringify({ accountIds, limit: 5 }),
      });
      if (!res.ok) {
        if (res.status !== 404) logger.warn(`[task-dispatch] HTTP ${res.status}`);
        return;
      }
      dispatched = (await res.json()) as any[];
    } catch (err) {
      logger.warn(`[task-dispatch] fetch error: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!dispatched.length) return;
    logger.info(`[task-dispatch] received ${dispatched.length} task(s)`);

    for (const t of dispatched) {
      const slot = slots.get(t.accountId);
      if (!slot) {
        await taskCallbacks.markFailed(t.id, `Account ${t.accountId?.slice(0, 8)} not connected to this agent`);
        continue;
      }
      // 串行执行（同一时刻一个 agent 不并行跑多个 task 给同一个号）
      const { executeTask } = await import('./tasks/task-runner');
      // 把所有 connected client 给 executor (chat_script 多账号编排用)
      const allClients = new Map<string, import('telegram').TelegramClient>();
      for (const [accId, s] of slots) allClients.set(accId, s.client);

      await executeTask(
        { id: t.id, type: t.type, accountId: t.accountId, accountLabel: t.accountLabel, payload: t.payload, tenantId: t.tenantId ?? null },
        slot.client,
        taskCallbacks,
        allClients,
      ).catch((err) => {
        logger.error(`[task ${t.id?.slice(0, 8)}] uncaught: ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  const taskTimer = setInterval(() => {
    void dispatchTasks();
  }, TASK_POLL_INTERVAL_MS);

  onShutdown(async () => {
    clearInterval(pollTimer);
    clearInterval(taskTimer);
    await groupLeadCollector.shutdown();
    for (const id of [...slots.keys()]) {
      await disconnect(id);
    }
    logger.info('Agent shutdown complete');
  });

  logger.info(`TeleHubX Agent ready — server=${SERVER_URL} poll=${POLL_INTERVAL_MS}ms task-poll=${TASK_POLL_INTERVAL_MS}ms`);
}

bootstrap().catch((err: unknown) => {
  logger.error('Bootstrap failed:', err instanceof Error ? err : { err });
  process.exit(1);
});
