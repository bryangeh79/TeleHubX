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

/** 按 id 取单条 asset 元数据 (用户在前端"指定具体素材"时走这条) */
export async function fetchAssetById(assetId: string): Promise<RandomAsset | null> {
  const res = await fetch(`${API_BASE}/assets/${assetId}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as RandomAsset;
}

/** Stream asset bytes from server. agent 不缓存到磁盘，直接拿到 Buffer 给 GramJS。 */
export async function fetchAssetFile(assetId: string): Promise<Buffer | null> {
  const res = await fetch(`${API_BASE}/assets/${assetId}/file`, { headers: authHeaders() });
  if (!res.ok) return null;
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export interface RandomChatScript {
  id: string;
  name: string;
  type: 'A+B' | 'A+B+C+D';
  packId: string | null;
  category: string | null;
  rawScript: any;
  lines: any[];
}

export async function pickRandomChatScript(opts: {
  packId?: string;
  category?: string;
  type?: string;
}): Promise<RandomChatScript | null> {
  const params = new URLSearchParams();
  if (opts.packId) params.set('packId', opts.packId);
  if (opts.category) params.set('category', opts.category);
  if (opts.type) params.set('type', opts.type);
  const res = await fetch(`${API_BASE}/chat-scripts/random?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as RandomChatScript | null;
  return data ?? null;
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
