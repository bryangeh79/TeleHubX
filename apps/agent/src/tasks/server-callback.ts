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
  scrapedByAccountId?: string | null;
  priorityScore?: number;
}

export async function bulkUpsertCandidates(
  tenantId: string,
  items: CandidateUpsertItem[],
): Promise<{ inserted: number; updated: number } | null> {
  try {
    const res = await fetch(`${API_BASE}/lead-candidates/bulk-upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, items }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { inserted: number; updated: number };
  } catch {
    return null;
  }
}

export async function markCandidateContacted(
  candidateId: string,
  contactedByAccountId: string,
  contactTaskId?: string,
): Promise<void> {
  try {
    await fetch(`${API_BASE}/lead-candidates/${candidateId}/mark-contacted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactedByAccountId, contactTaskId }),
    });
  } catch {
    // 静默失败
  }
}
