/**
 * Diagnostic probe: spin up a single GramJS client for one account, connect,
 * fire a fixed set of RPCs with per-call timing + error capture, then exit.
 *
 * Goal: isolate whether RPC timeouts on a specific account are due to
 *   - the bridge / proxy
 *   - DC routing
 *   - TG-side soft-shadow on the session
 *   - target-specific failure (cross-DC / entity resolution)
 *
 * Usage (from repo root):
 *   cd apps/agent
 *   pnpm dlx tsx src/scripts/probe-account.ts --phone +447746513981
 *   pnpm dlx tsx src/scripts/probe-account.ts --phone +447746513981 --noProxy
 *   pnpm dlx tsx src/scripts/probe-account.ts --phone +447746513981 --proxyId 18b9...
 *
 * Output: a single JSON document on stdout, plus human-readable lines on stderr.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { Api } from 'telegram';
import { createTelegramClient, connectClient, disconnectClient, type ProxyConfig } from '../telegram/telegram-client.factory';

interface ApiAccount {
  id: string;
  phoneNumber: string;
  proxyId?: string | null;
  deviceFingerprint?: {
    deviceModel: string;
    systemVersion: string;
    appVersion: string;
    langCode: string;
    systemLangCode: string;
  } | null;
}

const FALLBACK_FINGERPRINT = {
  deviceModel: 'Samsung SM-S928B',
  systemVersion: 'Android 14',
  appVersion: '10.14.2',
  langCode: 'en',
  systemLangCode: 'en',
};

function parseArgs(): { phone: string; proxyIdOverride: string | null; noProxy: boolean } {
  const args = process.argv.slice(2);
  let phone = '';
  let proxyIdOverride: string | null = null;
  let noProxy = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phone') phone = args[++i] ?? '';
    else if (args[i] === '--proxyId') proxyIdOverride = args[++i] ?? null;
    else if (args[i] === '--noProxy') noProxy = true;
  }
  if (!phone) {
    console.error('Usage: probe-account.ts --phone <+447xxx> [--proxyId <uuid>] [--noProxy]');
    process.exit(1);
  }
  return { phone, proxyIdOverride, noProxy };
}

const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:9800').replace(/\/$/, '');
const API_BASE = `${SERVER_URL}/api/v1`;
const AGENT_TOKEN = process.env.AGENT_TOKEN ?? '';
const AUTH_HEADER: Record<string, string> = AGENT_TOKEN ? { 'X-Agent-Token': AGENT_TOKEN } : {};

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return (await res.json()) as T;
}

async function resolveProxy(proxyId: string): Promise<ProxyConfig | undefined> {
  try {
    const cfg = await fetchJson<{ ip: string; port: number; socksType: 4 | 5; username?: string; password?: string } | null>(
      `/proxies/${proxyId}/gram-config`,
    );
    if (cfg && cfg.ip && cfg.port) {
      return { ip: cfg.ip, port: cfg.port, socksType: cfg.socksType, username: cfg.username, password: cfg.password };
    }
  } catch (err) {
    console.error(`[proxy] failed to load ${proxyId.slice(0, 8)}: ${(err as Error).message}`);
  }
  return undefined;
}

interface ProbeResult {
  rpc: string;
  ok: boolean;
  ms: number;
  error?: string;
  errorClass?: string;
}

async function probeRpc(label: string, fn: () => Promise<unknown>): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    console.error(`  ✓ ${label.padEnd(32)} ${ms}ms`);
    return { rpc: label, ok: true, ms };
  } catch (err) {
    const ms = Date.now() - t0;
    const e = err as Error;
    const cls = e.constructor?.name ?? 'Error';
    const msg = e.message ?? String(err);
    console.error(`  ✗ ${label.padEnd(32)} ${ms}ms  [${cls}] ${msg.slice(0, 120)}`);
    return { rpc: label, ok: false, ms, error: msg, errorClass: cls };
  }
}

async function main() {
  const { phone, proxyIdOverride, noProxy } = parseArgs();
  const apiId = parseInt(process.env.TG_API_ID ?? '0', 10);
  const apiHash = process.env.TG_API_HASH ?? '';
  if (!apiId || !apiHash) throw new Error('TG_API_ID / TG_API_HASH missing in env');

  console.error(`▶ probe-account phone=${phone} proxyOverride=${proxyIdOverride ?? '(none)'} noProxy=${noProxy}`);

  // Find account by phone
  const accounts = await fetchJson<ApiAccount[]>(`/accounts`);
  const acct = accounts.find((a) => a.phoneNumber === phone);
  if (!acct) throw new Error(`account ${phone} not found in /accounts`);
  console.error(`✓ account ${acct.id.slice(0, 8)} (proxyId=${acct.proxyId ?? '(none)'})`);

  // Fetch session
  const sessionRes = await fetchJson<{ session: string }>(`/accounts/${acct.id}/session/raw`);
  const session = sessionRes.session ?? '';
  if (!session) throw new Error('empty sessionString');
  console.error(`✓ session loaded (${session.length} chars)`);

  // Resolve proxy
  let proxy: ProxyConfig | undefined;
  if (noProxy) {
    proxy = undefined;
    console.error('→ no proxy (direct connection from this host)');
  } else {
    const useProxyId = proxyIdOverride ?? acct.proxyId;
    if (useProxyId) {
      proxy = await resolveProxy(useProxyId);
      if (proxy) console.error(`✓ proxy ${useProxyId.slice(0, 8)} → ${proxy.ip}:${proxy.port} (socks${proxy.socksType})`);
      else console.error(`✗ proxy ${useProxyId.slice(0, 8)} returned null — connecting direct`);
    } else {
      console.error('→ account has no proxyId, connecting direct');
    }
  }

  // Build client (uses production factory + same RPC-timeout patch)
  const client = createTelegramClient({
    phoneNumber: phone,
    sessionString: session,
    apiId,
    apiHash,
    proxy,
    deviceFingerprint: acct.deviceFingerprint ?? FALLBACK_FINGERPRINT,
  });

  const tConn = Date.now();
  try {
    await connectClient(client);
    console.error(`✓ connected in ${Date.now() - tConn}ms`);
  } catch (err) {
    const ms = Date.now() - tConn;
    console.error(`✗ connect failed in ${ms}ms: ${(err as Error).message}`);
    console.log(JSON.stringify({ phone, proxy: proxy ?? null, connect: { ok: false, ms, error: (err as Error).message } }, null, 2));
    process.exit(2);
  }

  // ── Probe matrix ────────────────────────────────────────────────────────
  const results: ProbeResult[] = [];

  // P1: account.UpdateStatus — local DC, write, used by keepalive (the most basic RPC)
  results.push(await probeRpc('account.UpdateStatus(offline:false)', async () => {
    await client.invoke(new Api.account.UpdateStatus({ offline: false }));
  }));

  // P2: help.GetConfig — pure read, exposes DC list, MTProto-level
  results.push(await probeRpc('help.GetConfig', async () => {
    await client.invoke(new Api.help.GetConfig());
  }));

  // P3: contacts.ResolveUsername(durov) — cross-DC entity resolution
  results.push(await probeRpc('contacts.ResolveUsername(durov)', async () => {
    await client.invoke(new Api.contacts.ResolveUsername({ username: 'durov' }));
  }));

  // P4: messages.GetDialogs limit=5 — local DC, common task RPC
  results.push(await probeRpc('messages.GetDialogs(limit:5)', async () => {
    await client.invoke(new Api.messages.GetDialogs({
      offsetDate: 0,
      offsetId: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      limit: 5,
      hash: 0n as any,
    }));
  }));

  // ── Cleanup ─────────────────────────────────────────────────────────────
  try {
    await disconnectClient(client);
    console.error('✓ disconnected cleanly');
  } catch (err) {
    console.error(`✗ disconnect: ${(err as Error).message}`);
  }

  // Summary
  const summary = {
    phone,
    accountId: acct.id,
    proxy: proxy ?? null,
    sessionLength: session.length,
    deviceFingerprint: acct.deviceFingerprint ?? FALLBACK_FINGERPRINT,
    connectMs: Date.now() - tConn,
    probes: results,
    verdict: classifyVerdict(results),
  };
  console.log(JSON.stringify(summary, null, 2));
}

function classifyVerdict(results: ProbeResult[]): string {
  const allOk = results.every((r) => r.ok);
  const allTimeout = results.every((r) => !r.ok && /timeout/i.test(r.error ?? ''));
  const someOk = results.some((r) => r.ok);
  if (allOk) return 'all-ok';
  if (allTimeout) return 'all-rpc-timeout (likely TG soft-shadow on session)';
  if (someOk) return 'mixed (likely cross-DC or specific entity issues)';
  return 'all-failed-mixed-errors';
}

main().catch((err) => {
  console.error(`FATAL: ${(err as Error).stack ?? err}`);
  process.exit(3);
});
