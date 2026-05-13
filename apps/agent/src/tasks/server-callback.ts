/**
 * 给 executor 用的轻量 server 回调 helper。
 * 用于：群成员爬取写入 lead_candidates、触达完成回写 markContacted 等。
 */

const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:9800').replace(/\/$/, '');
const API_BASE = `${SERVER_URL}/api/v1`;

export interface CandidateUpsertItem {
  tgUserId: string;
  tgUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  sourceGroupId?: string | null;
  sourceGroupTitle?: string | null;
  phone?: string | null;
  lastSeenAt?: string | null;
  isPremium?: boolean;
  isBot?: boolean;
  scrapedByAccountId?: string | null;
  huntTaskId?: string | null;
  priorityScore?: number;
}

export async function bulkUpsertCandidates(
  tenantId: string,
  items: CandidateUpsertItem[],
): Promise<{ inserted: number; updated: number } | null> {
  try {
    const res = await fetch(`${API_BASE}/lead-candidates/bulk-upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AGENT_TOKEN ? { 'X-Agent-Token': process.env.AGENT_TOKEN } : {}),
      },
      body: JSON.stringify({ tenantId, items }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { inserted: number; updated: number };
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  return process.env.AGENT_TOKEN ? { 'X-Agent-Token': process.env.AGENT_TOKEN } : {};
}

export interface RandomAsset {
  id: string;
  category: 'photo' | 'video' | 'voice' | 'document' | 'text_snippet';
  fileName: string;
  mimeType: string | null;
  byteSize: number;
  poolName: string | null;
  relativePath: string | null;
}

export async function pickRandomAsset(opts: {
  poolName?: string;
  category?: string;
  tenantId?: string;
}): Promise<RandomAsset | null> {
  const params = new URLSearchParams();
  if (opts.poolName) params.set('poolName', opts.poolName);
  if (opts.category) params.set('category', opts.category);
  if (opts.tenantId) params.set('tenantId', opts.tenantId);
  const url = `${API_BASE}/assets/random?${params.toString()}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as RandomAsset;
}

/** 按 id 取单条 asset 元数据 (用户在前端"指定具体素材"时走这条)
 *  Codex #11: 必须传 tenantId 让 server 校验素材属于此租户, 防跨租户拉素材。 */
export async function fetchAssetById(assetId: string, tenantId?: string): Promise<RandomAsset | null> {
  const url = tenantId
    ? `${API_BASE}/assets/${assetId}?tenantId=${encodeURIComponent(tenantId)}`
    : `${API_BASE}/assets/${assetId}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as RandomAsset;
}

export async function fetchAssetFile(assetId: string, tenantId?: string): Promise<Buffer | null> {
  const url = tenantId
    ? `${API_BASE}/assets/${assetId}/file?tenantId=${encodeURIComponent(tenantId)}`
    : `${API_BASE}/assets/${assetId}/file`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export interface RandomChatScript {
  id: string;
  name: string;
  type: 'A+B' | 'A+B+C+D' | 'A+B+C+D+E+F';   // Codex #5: 加 6P 类型
  packId: string | null;
  category: string | null;
  rawScript: any;
  lines: any[];
}

export async function pickRandomChatScript(opts: {
  packId?: string;
  category?: string;
  type?: string;
  tenantId?: string;     // Codex #11: 必须传 tenantId 防跨租户
}): Promise<RandomChatScript | null> {
  const params = new URLSearchParams();
  if (opts.packId) params.set('packId', opts.packId);
  if (opts.category) params.set('category', opts.category);
  if (opts.type) params.set('type', opts.type);
  if (opts.tenantId) params.set('tenantId', opts.tenantId);
  const res = await fetch(`${API_BASE}/chat-scripts/random?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as RandomChatScript | null;
  return data ?? null;
}

/** 按 id 取剧本 — Codex #4: scriptId 选择走此路径 */
export async function fetchChatScriptById(
  scriptId: string,
  tenantId?: string,
): Promise<RandomChatScript | null> {
  const url = tenantId
    ? `${API_BASE}/chat-scripts/${scriptId}?tenantId=${encodeURIComponent(tenantId)}`
    : `${API_BASE}/chat-scripts/${scriptId}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as RandomChatScript;
}

export async function markCandidateContacted(
  candidateId: string,
  contactedByAccountId: string,
  contactTaskId?: string,
): Promise<void> {
  try {
    await fetch(`${API_BASE}/lead-candidates/${candidateId}/mark-contacted`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AGENT_TOKEN ? { 'X-Agent-Token': process.env.AGENT_TOKEN } : {}),
      },
      body: JSON.stringify({ contactedByAccountId, contactTaskId }),
    });
  } catch {
    // 静默失败
  }
}

// ── DiscoveredGroups（关键词发现群池）────────────────────────────

export interface DiscoveredGroupUpsertItem {
  tgChatId: string;
  tgUsername?: string | null;
  title: string;
  kind: 'mega' | 'channel' | 'basic' | 'gigagroup';
  participantsCount?: number;
  isGigagroup?: boolean;
  hasRealSenders?: boolean;
  sampledMessages?: number;
  sampledRealSenders?: number;
  keyword?: string | null;
  discoveredByAccountId?: string | null;
  discoverTaskId?: string | null;
  // vmfix28 新字段（all optional，向后兼容）
  /** #2 群被发现的来源 */
  discoverSource?: 'contacts' | 'global' | 'invite_harvest';
  /** B2 AI 评分 0-100 */
  aiScore?: number | null;
  /** B2 AI 评分理由 */
  aiReason?: string | null;
  /** B4 最近 7 天消息占比 (0-100) */
  recentMessageRate?: number;
}

export async function bulkUpsertDiscoveredGroups(
  tenantId: string,
  items: DiscoveredGroupUpsertItem[],
): Promise<{ inserted: number; updated: number } | null> {
  try {
    const res = await fetch(`${API_BASE}/discovered-groups/bulk-upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ tenantId, items }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { inserted: number; updated: number };
  } catch {
    return null;
  }
}

/**
 * vmfix27 #A3: 把单个关键词扩展成 N 个语义变体（AI）。
 * 失败 / AI 不可用 → fallback 到 [原始 keyword]。
 */
export async function expandKeywordsViaAI(
  keyword: string,
  maxVariants = 8,
): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/ai/expand-keywords`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ keyword, maxVariants }),
    });
    if (!res.ok) return [keyword];
    const j = await res.json() as { variants: string[]; fromAi: boolean };
    return Array.isArray(j.variants) && j.variants.length ? j.variants : [keyword];
  } catch {
    return [keyword];
  }
}

/**
 * vmfix27 #B2: AI 给单个群打目标客户匹配度（0-100）。
 * 失败 / AI 不可用 → 返回 null，调用方继续用结构化 qualityScore.
 */
export async function scoreGroupMatchViaAI(opts: {
  groupTitle: string;
  groupDescription?: string;
  sampleMessages?: string[];
  targetAudience: string;
}): Promise<{ score: number; reason: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/ai/score-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(opts),
    });
    if (!res.ok) return null;
    const j = await res.json() as { score: number; reason: string } | null;
    return j;
  } catch {
    return null;
  }
}

/**
 * vmfix28 C2: 「发现+加群」一体化 — agent 在 discover 任务完成后调此自动派
 * A 档群（quality >= threshold）的 join+scrape 任务对.
 * 失败静默（不阻塞主任务 markDone）.
 */
export async function autoJoinATierFromAgent(opts: {
  tenantId: string;
  accountId: string;
  minQuality?: number;
  limit?: number;
}): Promise<{ dispatched: number; failed?: number; reason?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/discovered-groups/auto-join-a-tier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(opts),
    });
    if (!res.ok) return null;
    return await res.json() as { dispatched: number; failed?: number; reason?: string };
  } catch {
    return null;
  }
}

/**
 * vmfix28 D2: FloodWait 跨账号 task 重派 — 调 server 把 task.accountId 改成
 * 同 tenant 另一空闲账号（白名单类型才生效）.
 * 成功返回 { reassigned: true, newAccountId }，失败 { reassigned: false, reason }.
 */
export async function reassignTaskToAnotherAccount(
  taskId: string,
  currentAccountId: string,
): Promise<{ reassigned: boolean; newAccountId?: string; reason?: string }> {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/reassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ excludeAccountId: currentAccountId }),
    });
    if (!res.ok) return { reassigned: false, reason: `HTTP ${res.status}` };
    return await res.json() as { reassigned: boolean; newAccountId?: string; reason?: string };
  } catch (err: any) {
    return { reassigned: false, reason: err?.message ?? String(err) };
  }
}

/**
 * vmfix27 #C4: 查询同 (tenantId, keyword) 在最近 N 小时内已发现的 tgChatId 集合，
 * agent 跑前可用来跳过已知群（增量发现）。
 * 失败返回 null → 调用方应当继续完整搜索。
 */
export async function fetchRecentDiscoveredChatIds(
  tenantId: string,
  keyword: string,
  withinHours = 24,
): Promise<Set<string> | null> {
  try {
    const url = new URL(`${API_BASE}/discovered-groups/recent`);
    url.searchParams.set('tenantId', tenantId);
    url.searchParams.set('keyword', keyword);
    url.searchParams.set('withinHours', String(withinHours));
    const res = await fetch(url.toString(), { headers: authHeaders() });
    if (!res.ok) return null;
    const j = await res.json() as { tgChatIds: string[] };
    return new Set(j.tgChatIds ?? []);
  } catch {
    return null;
  }
}

/**
 * Codex round-8: campaign_single 真消息发送成功后立即标记 task.messageSentAt,
 * 防 reportCampaignSent 失败 → task failed → retry 重发同一消息给客户.
 * 失败静默 — server 端 sentCountedAt 仍是最终幂等门.
 */
export async function markTaskMessageSent(taskId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AGENT_TOKEN ? { 'X-Agent-Token': process.env.AGENT_TOKEN } : {}),
      },
      body: JSON.stringify({ messageSentAt: new Date().toISOString() }),
    });
  } catch {
    // 静默失败: 这是 best-effort 防重发标记, 失败也不应阻塞主流程
  }
}

/** 上报 campaign 已发送 +1 (campaignSingle 执行器在每条发送完成后调用)
 *  Codex round-5 #1: taskId 必传, 防 sentCount 被刷 + server 端用 sentCountedAt 幂等
 *  Codex round-7 #1: 不再静默吞错, 3 次重试 + 失败抛出
 *    若真失败, runner 会 markFailed 此 task → 重试时新一轮 sendMessage + reportCampaignSent
 *    server 端 sentCountedAt IS NULL 守卫确保不重复 +1
 *    极端情况下消息重发但计数正确, 比 "消息发了但 sentCount 永远少算" 更可恢复
 */
export async function reportCampaignSent(campaignId: string, taskId: string, delta = 1): Promise<void> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/sent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.AGENT_TOKEN ? { 'X-Agent-Token': process.env.AGENT_TOKEN } : {}),
        },
        body: JSON.stringify({ delta, taskId }),
      });
      if (!res.ok) {
        // 4xx 不重试 (业务拒绝, 重试也无意义)
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`reportCampaignSent HTTP ${res.status}`);
        }
        throw new Error(`reportCampaignSent HTTP ${res.status} (attempt ${attempt}/3)`);
      }
      return;  // 成功
    } catch (err: any) {
      lastErr = err;
      // 4xx 类型错误不重试
      if (/HTTP 4\d\d/.test(err?.message ?? '')) throw err;
      // 重试前等待 1s/2s/3s
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw new Error(`reportCampaignSent 失败 (3 次重试均失败): ${lastErr?.message ?? lastErr}`);
}
