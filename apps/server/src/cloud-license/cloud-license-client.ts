/**
 * Thin HTTP client for the TeleHubX License Worker
 *   https://telehubx-license.starbright-solutions.com
 *
 * No business logic — caller decides what to do with errors.
 */

export interface ActivateResponse {
  ok: true;
  licenseId: string;
  tenantName: string;
  plan: string;
  maxAccounts: number;
  expiresAt: string | null;
  userEmail: string | null;
  userRole: string | null;
  agentToken: string;
  agentTokenExpiresAt: string;
  firstBind: boolean;
}

export interface VerifyResponse {
  ok: true;
  licenseId: string;
  tenantName: string;
  plan: string;
  maxAccounts: number;
  expiresAt: string | null;
  userEmail: string | null;
  userRole: string | null;
}

export interface HeartbeatResponse {
  ok: true;
  serverTime: string;
}

export class CloudLicenseError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) { super(message); this.name = 'CloudLicenseError'; }
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function postJson<T>(baseUrl: string, path: string, body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(baseUrl.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (err: any) {
    throw new CloudLicenseError(0, 'network_error', String(err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
  let parsed: any;
  try { parsed = await res.json(); }
  catch { throw new CloudLicenseError(res.status, 'bad_response', `non-JSON response (status=${res.status})`); }
  if (!res.ok || parsed?.ok !== true) {
    const code = String(parsed?.error ?? 'http_' + res.status);
    const msg = String(parsed?.message ?? parsed?.error ?? `HTTP ${res.status}`);
    throw new CloudLicenseError(res.status, code, msg);
  }
  return parsed as T;
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(baseUrl.replace(/\/$/, '') + path, { signal: ctl.signal });
  } catch (err: any) {
    throw new CloudLicenseError(0, 'network_error', String(err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
  let parsed: any;
  try { parsed = await res.json(); }
  catch { throw new CloudLicenseError(res.status, 'bad_response', `non-JSON response (status=${res.status})`); }
  if (!res.ok) {
    throw new CloudLicenseError(res.status, String(parsed?.error ?? 'http_' + res.status),
      String(parsed?.message ?? `HTTP ${res.status}`));
  }
  return parsed as T;
}

export class CloudLicenseClient {
  constructor(private readonly baseUrl: string) {}

  health() {
    return getJson<{ ok: boolean; service: string; product: string; dbBound: boolean; time: string }>(
      this.baseUrl, '/health', 5_000,
    );
  }

  activate(input: {
    licenseKey: string;
    email?: string | null;
    password?: string | null;
    machineFingerprint: string;
    hostname: string;
    agentVersion: string;
  }): Promise<ActivateResponse> {
    return postJson<ActivateResponse>(this.baseUrl, '/license/activate', input);
  }

  verify(agentToken: string): Promise<VerifyResponse> {
    return postJson<VerifyResponse>(this.baseUrl, '/license/verify', { agentToken });
  }

  heartbeat(input: {
    agentToken: string;
    localAccountCount: number;
    runningTaskCount: number;
    agentVersion: string;
  }): Promise<HeartbeatResponse> {
    return postJson<HeartbeatResponse>(this.baseUrl, '/agents/heartbeat', input);
  }
}
