import { HttpException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Server-side proxy for the TeleHubX License Worker's admin routes.
 *
 * Why proxy instead of letting the dashboard call the Worker directly?
 *   - ADMIN_TOKEN must NEVER reach the browser; CORS isn't enabled on the
 *     Worker; admin role checks live in our local JWT.
 *
 * The local SUPER_ADMIN role is required (enforced at the controller).
 * The Bearer token sent to the Worker comes from LICENSE_ADMIN_TOKEN env
 * on the SaaS-admin install (this is the same value as the Worker's
 * ADMIN_TOKEN secret). On non-admin installs leave it unset and these
 * endpoints return 503.
 */
@Injectable()
export class CloudLicenseAdminService {
  private readonly logger = new Logger(CloudLicenseAdminService.name);
  private readonly baseUrl: string;
  private readonly adminToken: string | null;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('LICENSE_SERVER_URL')
      ?? 'https://telehubx-license.starbright-solutions.com';
    this.adminToken = config.get<string>('LICENSE_ADMIN_TOKEN') ?? null;
  }

  available(): boolean {
    return !!this.adminToken;
  }

  // ─── pass-through callers ───────────────────────────────────────────────
  async createLicense(body: {
    tenantName: string;
    contact?: string | null;
    plan: 'basic' | 'pro' | 'enterprise';
    expiresAt?: string | null;
    email: string;
    initialPassword: string;
    role?: 'admin' | 'operator' | 'viewer';
  }) { return this.post('/admin/licenses/create', body); }

  listLicenses() { return this.get('/admin/licenses'); }
  listUsers() { return this.get('/admin/users'); }

  revokeLicense(id: string) { return this.post(`/admin/licenses/${encodeURIComponent(id)}/revoke`, {}); }
  extendLicense(id: string, expiresAt: string) {
    return this.post(`/admin/licenses/${encodeURIComponent(id)}/extend`, { expiresAt });
  }
  unbindLicense(id: string) { return this.post(`/admin/licenses/${encodeURIComponent(id)}/unbind`, {}); }
  changePlan(id: string, plan: 'basic' | 'pro' | 'enterprise') {
    return this.post(`/admin/licenses/${encodeURIComponent(id)}/change-plan`, { plan });
  }

  attachUser(tenantId: string, body: { email: string; password: string; role?: string }) {
    return this.post(`/admin/tenants/${encodeURIComponent(tenantId)}/users`, body);
  }

  resetUserPassword(userId: string) {
    return this.post(`/admin/users/${encodeURIComponent(userId)}/reset-password`, {});
  }
  disableUser(userId: string) {
    return this.post(`/admin/users/${encodeURIComponent(userId)}/disable`, {});
  }
  enableUser(userId: string) {
    return this.post(`/admin/users/${encodeURIComponent(userId)}/enable`, {});
  }

  // ─── HTTP helpers ───────────────────────────────────────────────────────
  private requireToken(): string {
    if (!this.adminToken) {
      throw new HttpException(
        { code: 'admin_token_unset',
          message: 'LICENSE_ADMIN_TOKEN env var is not set on this server. Set it to the Worker ADMIN_TOKEN to enable Cloud Admin operations.' },
        503,
      );
    }
    return this.adminToken;
  }

  private async post(path: string, body: unknown): Promise<any> {
    const token = this.requireToken();
    return this.requestJson('POST', path, body, token);
  }

  private async get(path: string): Promise<any> {
    const token = this.requireToken();
    return this.requestJson('GET', path, undefined, token);
  }

  private async requestJson(method: 'GET' | 'POST', path: string, body: unknown, token: string): Promise<any> {
    const url = this.baseUrl.replace(/\/$/, '') + path;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (err: any) {
      throw new InternalServerErrorException({
        code: 'network_error',
        message: `Cannot reach license server: ${String(err?.message ?? err)}`,
      });
    } finally {
      clearTimeout(timer);
    }
    let parsed: any;
    try { parsed = await res.json(); }
    catch { throw new InternalServerErrorException({ code: 'bad_response', message: `Non-JSON HTTP ${res.status}` }); }

    if (!res.ok || parsed?.ok === false) {
      // forward Worker's error code/message + status
      throw new HttpException(
        { code: parsed?.error ?? 'http_' + res.status, message: parsed?.message ?? `HTTP ${res.status}`, allowed: parsed?.allowed },
        res.status === 200 ? 400 : res.status,
      );
    }
    return parsed;
  }
}
