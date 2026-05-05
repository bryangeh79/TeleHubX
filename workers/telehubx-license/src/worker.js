/**
 * TeleHubX License Worker
 * ─────────────────────────────────────────────────────────────────────────
 * Cloudflare Worker — license-only backend for TeleHubX.
 *
 * Handles:
 *   • License activation (1st-time bind to a machine)
 *   • License verification (periodic re-check)
 *   • Agent heartbeat (online status + counts)
 *   • Admin license management (create / list / revoke / extend / unbind)
 *
 * NEVER stored / proxied here:
 *   • Telegram sessions / proxy creds / campaigns / tasks / leads / assets
 *   • Customer messages / chat scripts / AI keys
 *   • Anything tenant-business other than license + agent heartbeat metadata
 *
 * Bindings expected:
 *   D1:       DB
 *   Secrets:  ADMIN_TOKEN, LICENSE_PEPPER, AGENT_TOKEN_SECRET
 *
 * Product is locked to "telehubx".  Key prefix locked to "THX-".
 */

const PRODUCT = 'telehubx';
const LICENSE_PREFIX = 'THX-';
const AGENT_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

// ─── plan → maxAccounts (server-side source of truth) ─────────────────────
const PLAN_MAX_ACCOUNTS = {
  basic:      10,
  pro:        30,
  enterprise: 50,
};

// ─── Worker entry ────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;

      // ── public / agent ─────────────────────────────────────────
      // NB: every async branch is awaited so that any rejection (D1 error,
      // missing column, etc.) hits the outer try/catch and is converted to
      // a JSON 500 instead of escaping as Cloudflare error 1101.
      if (route === 'GET /health')             return await health(env);
      if (route === 'POST /license/activate')  return await jsonRoute(request, env, activate);
      if (route === 'POST /license/verify')    return await jsonRoute(request, env, verify);
      if (route === 'POST /agents/heartbeat')  return await jsonRoute(request, env, heartbeat);

      // ── admin (require Bearer ADMIN_TOKEN) ─────────────────────
      if (url.pathname.startsWith('/admin/')) {
        const adminCheck = requireAdmin(request, env);
        if (adminCheck) return adminCheck;

        if (route === 'POST /admin/licenses/create') return await jsonRoute(request, env, adminCreateLicense);
        if (route === 'GET  /admin/licenses' || route === 'GET /admin/licenses') return await adminListLicenses(env);
        if (route === 'GET  /admin/users'    || route === 'GET /admin/users')    return await adminListUsers(env);

        // /admin/licenses/:id/{revoke|extend|unbind|change-plan}
        const lm = url.pathname.match(/^\/admin\/licenses\/([^/]+)\/(revoke|extend|unbind|change-plan)$/);
        if (lm && request.method === 'POST') {
          const [, id, op] = lm;
          if (op === 'revoke')      return await jsonRoute(request, env, (b, e) => adminRevoke(b, e, id));
          if (op === 'extend')      return await jsonRoute(request, env, (b, e) => adminExtend(b, e, id));
          if (op === 'unbind')      return await jsonRoute(request, env, (b, e) => adminUnbind(b, e, id));
          if (op === 'change-plan') return await jsonRoute(request, env, (b, e) => adminChangePlan(b, e, id));
        }

        // /admin/tenants/:tenantId/users  → attach a user to an existing tenant
        const tu = url.pathname.match(/^\/admin\/tenants\/([^/]+)\/users$/);
        if (tu && request.method === 'POST') {
          const [, tenantId] = tu;
          return await jsonRoute(request, env, (b, e) => adminAttachUser(b, e, tenantId));
        }

        // /admin/users/:id/{reset-password|disable|enable}
        const um = url.pathname.match(/^\/admin\/users\/([^/]+)\/(reset-password|disable|enable)$/);
        if (um && request.method === 'POST') {
          const [, userId, op] = um;
          if (op === 'reset-password') return await jsonRoute(request, env, (b, e) => adminResetUserPwd(b, e, userId));
          if (op === 'disable')        return await jsonRoute(request, env, (b, e) => adminSetUserStatus(b, e, userId, 'disabled'));
          if (op === 'enable')         return await jsonRoute(request, env, (b, e) => adminSetUserStatus(b, e, userId, 'active'));
        }
      }

      return jsonResp({ ok: false, error: 'not_found' }, 404);
    } catch (err) {
      // never leak secrets / stack — but DO surface the message so D1
      // mismatches are debuggable from the client side.
      return jsonResp({ ok: false, error: 'server_error', message: String(err?.message ?? err).slice(0, 300) }, 500);
    }
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────
function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function jsonRoute(request, env, handler) {
  let body = {};
  if (request.method === 'POST') {
    const text = await request.text();
    if (text) {
      try { body = JSON.parse(text); }
      catch { return jsonResp({ ok: false, error: 'bad_json' }, 400); }
    }
  }
  return handler(body, env, request);
}

function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.ADMIN_TOKEN ?? ''}`;
  if (!env.ADMIN_TOKEN || !timingSafeEq(auth, expected)) {
    return jsonResp({ ok: false, error: 'unauthorized' }, 401);
  }
  return null;
}

function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function nowIso() { return new Date().toISOString(); }

function uuid() {
  // crypto.randomUUID() is available in Workers
  return crypto.randomUUID();
}

// random hex segment of N chars (uppercase)
function hexSeg(n) {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().slice(0, n);
}

function generateLicenseKey() {
  // THX-XXXX-XXXX-XXXX  (12 hex chars, uppercase)
  return `${LICENSE_PREFIX}${hexSeg(4)}-${hexSeg(4)}-${hexSeg(4)}`;
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashLicenseKey(key, env) {
  if (!env.LICENSE_PEPPER) throw new Error('LICENSE_PEPPER not set');
  return sha256Hex(`${key}:${env.LICENSE_PEPPER}`);
}

// ─── password (PBKDF2-SHA256, 100k iter, 32-byte hash, 16-byte salt) ─────
const PWD_SCHEME = 'pbkdf2';
const PWD_ITER = 100_000;
const PWD_HASH_BYTES = 32;
const PWD_SALT_BYTES = 16;
// Strength: 8+ chars, contain at least 1 digit. Tighter rules belong on the
// admin tooling side; this is a server-side floor.
const PWD_MIN_LEN = 8;

function b64Plain(bytes) {
  return btoa(String.fromCharCode(...bytes));
}
function b64PlainDecode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2Derive(password, salt, iter, env) {
  const pepper = env.USER_PASSWORD_PEPPER ?? '';
  if (!pepper) throw new Error('USER_PASSWORD_PEPPER not set');
  const passKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${password}:${pepper}`),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    passKey,
    PWD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function passwordHash(password, env) {
  const salt = crypto.getRandomValues(new Uint8Array(PWD_SALT_BYTES));
  const hash = await pbkdf2Derive(password, salt, PWD_ITER, env);
  return `${PWD_SCHEME}$${PWD_ITER}$${b64Plain(salt)}$${b64Plain(hash)}`;
}

async function passwordVerify(password, stored, env) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PWD_SCHEME) return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter < 1000 || iter > 1_000_000) return false;
  let salt, expected;
  try {
    salt = b64PlainDecode(parts[2]);
    expected = b64PlainDecode(parts[3]);
  } catch { return false; }
  const got = await pbkdf2Derive(password, salt, iter, env);
  if (got.length !== expected.length) return false;
  let r = 0;
  for (let i = 0; i < got.length; i++) r |= got[i] ^ expected[i];
  return r === 0;
}

function generateTempPassword() {
  // 12 chars from URL-safe alphabet; guaranteed ≥1 digit + 1 letter.
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const a = 'abcdefghjkmnpqrstuvwxyz';
  const d = '23456789';
  const all = A + a + d;
  const buf = crypto.getRandomValues(new Uint8Array(12));
  const out = [];
  // force first three chars to span classes
  out.push(A[buf[0] % A.length]);
  out.push(a[buf[1] % a.length]);
  out.push(d[buf[2] % d.length]);
  for (let i = 3; i < 12; i++) out.push(all[buf[i] % all.length]);
  // shuffle
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function normEmail(s) {
  return String(s ?? '').trim().toLowerCase();
}

function isValidRole(r) {
  return r === 'admin' || r === 'operator' || r === 'viewer';
}

// ─── agent token (compact HMAC-SHA256, JWT-like) ─────────────────────────
function b64uEncode(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

async function signAgentToken(env, payload) {
  if (!env.AGENT_TOKEN_SECRET) throw new Error('AGENT_TOKEN_SECRET not set');
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB = b64uEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB = b64uEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const data = `${headerB}.${payloadB}`;
  const sig = await hmacSha256(env.AGENT_TOKEN_SECRET, data);
  return `${data}.${b64uEncode(sig)}`;
}

async function verifyAgentToken(env, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB, payloadB, sigB] = parts;
  const data = `${headerB}.${payloadB}`;
  const sig = await hmacSha256(env.AGENT_TOKEN_SECRET, data);
  const expected = b64uEncode(sig);
  if (!timingSafeEq(expected, sigB)) return null;

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64uDecode(payloadB))); }
  catch { return null; }

  if (typeof payload?.exp === 'number' && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// ─── audit ────────────────────────────────────────────────────────────────
// Schema: audit_logs(id, actor, action, target_id, detail_json, created_at)
// (target_type is encoded inside detail_json.targetType so we don't need the column)
async function audit(env, action, targetType, targetId, actor, meta) {
  const detail = { ...(meta ?? {}) };
  if (targetType) detail.targetType = targetType;
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, actor, action, target_id, detail_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(uuid(), actor ?? null, action, targetId ?? null,
         Object.keys(detail).length ? JSON.stringify(detail) : null, nowIso())
   .run().catch(() => { /* audit failure must not break primary op */ });
}

// ─── Routes ──────────────────────────────────────────────────────────────

// GET /health
async function health(env) {
  let dbBound = false;
  try {
    const r = await env.DB.prepare('SELECT 1 AS ok').first();
    dbBound = r?.ok === 1;
  } catch { dbBound = false; }
  return jsonResp({
    ok: true,
    service: 'telehubx-license',
    product: PRODUCT,
    dbBound,
    time: nowIso(),
  });
}

// POST /admin/licenses/create
//
// Backwards-compatible: if `email` and `initialPassword` are omitted,
// only the tenant + license are created (as before). If both are supplied,
// a tenant_user is created in the same transaction with role 'admin'.
async function adminCreateLicense(body, env) {
  const tenantName     = String(body?.tenantName ?? '').trim();
  const contact        = body?.contact == null ? null : String(body.contact).trim();
  const planRaw        = String(body?.plan ?? '').trim().toLowerCase();
  const expiresAt      = body?.expiresAt == null ? null : String(body.expiresAt);
  const email          = body?.email == null ? null : normEmail(body.email);
  const initialPassword = body?.initialPassword == null ? null : String(body.initialPassword);
  const role           = body?.role == null ? 'admin' : String(body.role).toLowerCase();

  if (!tenantName) return jsonResp({ ok: false, error: 'tenantName_required' }, 400);
  if (!PLAN_MAX_ACCOUNTS[planRaw]) {
    return jsonResp({ ok: false, error: 'invalid_plan', allowed: Object.keys(PLAN_MAX_ACCOUNTS) }, 400);
  }
  // Server-side source of truth — ignore client-supplied maxAccounts
  const maxAccounts = PLAN_MAX_ACCOUNTS[planRaw];

  // user fields are optional for backwards-compat — but if either is given,
  // both must be valid.
  const wantsUser = email != null || initialPassword != null;
  if (wantsUser) {
    if (!email || !/.+@.+\..+/.test(email)) return jsonResp({ ok: false, error: 'email_invalid' }, 400);
    if (!initialPassword || initialPassword.length < PWD_MIN_LEN) {
      return jsonResp({ ok: false, error: 'initialPassword_too_short', minLength: PWD_MIN_LEN }, 400);
    }
    if (!isValidRole(role)) return jsonResp({ ok: false, error: 'invalid_role' }, 400);
  }

  // 1) tenant
  const tenantId = uuid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO tenants (id, product, tenant_name, contact, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`
  ).bind(tenantId, PRODUCT, tenantName, contact, now).run();

  // 2) license key (one-time plaintext returned)
  const licenseKey = generateLicenseKey();
  const licenseKeyHash = await hashLicenseKey(licenseKey, env);
  const licenseKeySuffix = licenseKey.slice(-4);

  const licenseId = uuid();
  await env.DB.prepare(
    `INSERT INTO licenses
       (id, tenant_id, product, license_key_hash, license_key_suffix,
        plan, max_accounts, status, expires_at, machine_fingerprint,
        activated_at, last_verified_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, NULL, NULL, NULL, ?9, ?9)`
  ).bind(licenseId, tenantId, PRODUCT, licenseKeyHash, licenseKeySuffix,
         planRaw, maxAccounts, expiresAt, now)
   .run();

  // 3) optional tenant_user
  let userId = null;
  if (wantsUser) {
    userId = uuid();
    const passwordHashed = await passwordHash(initialPassword, env);
    await env.DB.prepare(
      `INSERT INTO tenant_users
         (id, tenant_id, email, password_hash, role, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`
    ).bind(userId, tenantId, email, passwordHashed, role, now).run();
    await audit(env, 'user.create', 'user', userId, 'admin', { tenantId, email, role });
  }

  await audit(env, 'license.create', 'license', licenseId, 'admin', {
    tenantName, plan: planRaw, maxAccounts, expiresAt,
    user: wantsUser ? { id: userId, email, role } : null,
  });

  return jsonResp({
    ok: true,
    licenseId,
    tenantId,
    tenantName,
    plan: planRaw,
    maxAccounts,
    expiresAt,
    licenseKey,                                       // ← returned ONCE
    user: wantsUser ? { id: userId, email, role } : null,
    note: 'Store this license key safely — it is not retrievable again.',
  });
}

// GET /admin/licenses
async function adminListLicenses(env) {
  const rs = await env.DB.prepare(
    `SELECT
       l.id              AS id,
       l.tenant_id       AS tenant_id,
       t.tenant_name     AS tenant_name,
       t.contact         AS tenant_contact,
       l.product         AS product,
       l.plan            AS plan,
       l.max_accounts    AS max_accounts,
       l.license_key_suffix AS key_suffix,
       l.status          AS status,
       l.expires_at      AS expires_at,
       l.machine_fingerprint AS machine_fingerprint,
       l.activated_at    AS activated_at,
       l.last_verified_at AS last_verified_at,
       l.created_at      AS created_at
     FROM licenses l
     LEFT JOIN tenants t ON t.id = l.tenant_id
     ORDER BY l.created_at DESC`
  ).all();

  const licenses = (rs?.results ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantContact: row.tenant_contact,
    product: row.product,
    plan: row.plan,
    maxAccounts: row.max_accounts,
    keyMasked: row.key_suffix ? `THX-****-****-${row.key_suffix}` : 'THX-****',
    status: row.status,
    expiresAt: row.expires_at,
    bound: !!row.machine_fingerprint,
    machineFingerprintPreview: row.machine_fingerprint
      ? `${String(row.machine_fingerprint).slice(0, 6)}…${String(row.machine_fingerprint).slice(-4)}`
      : null,
    activatedAt: row.activated_at,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
  }));

  return jsonResp({ ok: true, count: licenses.length, licenses });
}

// POST /admin/licenses/:id/revoke
async function adminRevoke(_body, env, id) {
  const lic = await env.DB.prepare(`SELECT id FROM licenses WHERE id = ?1`).bind(id).first();
  if (!lic) return jsonResp({ ok: false, error: 'license_not_found' }, 404);

  await env.DB.prepare(`UPDATE licenses SET status = 'revoked', updated_at = ?1 WHERE id = ?2`)
    .bind(nowIso(), id).run();
  await audit(env, 'license.revoke', 'license', id, 'admin');
  return jsonResp({ ok: true, id, status: 'revoked' });
}

// POST /admin/licenses/:id/extend
async function adminExtend(body, env, id) {
  const newExpiresAt = body?.expiresAt;
  if (!newExpiresAt) return jsonResp({ ok: false, error: 'expiresAt_required' }, 400);
  // Light validation: parseable date
  if (Number.isNaN(Date.parse(String(newExpiresAt)))) {
    return jsonResp({ ok: false, error: 'expiresAt_invalid_iso' }, 400);
  }

  const lic = await env.DB.prepare(`SELECT id, expires_at FROM licenses WHERE id = ?1`).bind(id).first();
  if (!lic) return jsonResp({ ok: false, error: 'license_not_found' }, 404);

  await env.DB.prepare(`UPDATE licenses SET expires_at = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(String(newExpiresAt), nowIso(), id).run();
  await audit(env, 'license.extend', 'license', id, 'admin', {
    oldExpiresAt: lic.expires_at, newExpiresAt,
  });
  return jsonResp({ ok: true, id, expiresAt: newExpiresAt });
}

// POST /admin/licenses/:id/unbind
//
// Implementation note: we clear `machine_fingerprint` so the next
// /license/activate from any machine can rebind. We KEEP `activated_at`
// as a historical record (first activation timestamp). `agent_devices`
// rows are kept for audit; they'll be superseded by a new device row
// on next activation.
async function adminUnbind(_body, env, id) {
  const lic = await env.DB.prepare(`SELECT id, machine_fingerprint FROM licenses WHERE id = ?1`).bind(id).first();
  if (!lic) return jsonResp({ ok: false, error: 'license_not_found' }, 404);

  await env.DB.prepare(`UPDATE licenses SET machine_fingerprint = NULL, updated_at = ?1 WHERE id = ?2`)
    .bind(nowIso(), id).run();
  await audit(env, 'license.unbind', 'license', id, 'admin', {
    previousMachineFingerprint: lic.machine_fingerprint,
  });
  return jsonResp({ ok: true, id, unbound: true });
}

// POST /license/activate
//
// Body:
//   licenseKey, machineFingerprint, hostname, agentVersion          (always)
//   email, password                                                  (required if the
//                                                                    tenant has any users)
//
// Backwards-compat: if the tenant has zero tenant_users (legacy test data
// before migration 001), email/password are optional. Once an admin user
// has been attached, every subsequent activation must authenticate.
async function activate(body, env) {
  const licenseKey = String(body?.licenseKey ?? '').trim();
  const machineFingerprint = String(body?.machineFingerprint ?? '').trim();
  const hostname = body?.hostname == null ? null : String(body.hostname).slice(0, 200);
  const agentVersion = body?.agentVersion == null ? null : String(body.agentVersion).slice(0, 50);
  const email = body?.email == null ? null : normEmail(body.email);
  const password = body?.password == null ? null : String(body.password);

  if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) {
    return jsonResp({ ok: false, error: 'invalid_key_format' }, 400);
  }
  if (!machineFingerprint) {
    return jsonResp({ ok: false, error: 'machineFingerprint_required' }, 400);
  }

  const hash = await hashLicenseKey(licenseKey, env);
  const lic = await env.DB.prepare(
    `SELECT l.*, t.tenant_name AS tenant_name
     FROM licenses l
     LEFT JOIN tenants t ON t.id = l.tenant_id
     WHERE l.license_key_hash = ?1 AND l.product = ?2`
  ).bind(hash, PRODUCT).first();

  if (!lic) return jsonResp({ ok: false, error: 'license_not_found' }, 404);
  if (lic.status !== 'active') return jsonResp({ ok: false, error: `license_${lic.status}` }, 403);
  if (lic.expires_at && Date.parse(lic.expires_at) <= Date.now()) {
    return jsonResp({ ok: false, error: 'license_expired' }, 403);
  }

  // ── tenant user authentication ─────────────────────────────────────────
  // Single fixed-cost path even when the user/tenant doesn't exist, so we
  // don't leak user existence by timing.
  const tenantHasUsers = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tenant_users WHERE tenant_id = ?1`
  ).bind(lic.tenant_id).first();
  const requireAuth = (tenantHasUsers?.n ?? 0) > 0;

  let user = null;
  if (requireAuth || email || password) {
    if (!email || !password) {
      return jsonResp({ ok: false, error: 'email_password_required' }, 400);
    }
    user = await env.DB.prepare(
      `SELECT id, role, status, password_hash
       FROM tenant_users
       WHERE tenant_id = ?1 AND lower(email) = lower(?2)`
    ).bind(lic.tenant_id, email).first();

    // Even on miss, run a dummy verify against a constant hash so timing
    // doesn't reveal whether the email exists.
    const okPassword = user
      ? await passwordVerify(password, user.password_hash, env)
      : await passwordVerify(password, 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', env).catch(() => false);

    if (!user || !okPassword) {
      await audit(env, 'license.activate.reject_auth', 'license', lic.id, 'agent', {
        hostname, agentVersion, emailGiven: !!email,
      });
      return jsonResp({ ok: false, error: 'invalid_credentials' }, 401);
    }
    if (user.status !== 'active') {
      await audit(env, 'license.activate.reject_user_status', 'license', lic.id, 'agent', {
        hostname, agentVersion, userId: user.id, userStatus: user.status,
      });
      return jsonResp({ ok: false, error: `user_${user.status}` }, 403);
    }
  }

  // bind / verify machine
  if (lic.machine_fingerprint && lic.machine_fingerprint !== machineFingerprint) {
    await audit(env, 'license.activate.reject_mismatch', 'license', lic.id, 'agent', {
      hostname, agentVersion, userId: user?.id ?? null,
    });
    return jsonResp({
      ok: false,
      error: 'machine_mismatch',
      message: 'License is bound to another machine. Ask admin to unbind first.',
    }, 409);
  }

  const isFirstBind = !lic.machine_fingerprint;
  if (isFirstBind) {
    await env.DB.prepare(
      `UPDATE licenses
         SET machine_fingerprint = ?1, activated_at = ?2, updated_at = ?2
         WHERE id = ?3`
    ).bind(machineFingerprint, nowIso(), lic.id).run();
  }

  // upsert agent_devices row (1 device per license)
  const existingDev = await env.DB.prepare(
    `SELECT id FROM agent_devices WHERE license_id = ?1 AND machine_fingerprint = ?2`
  ).bind(lic.id, machineFingerprint).first();

  // Schema: agent_devices(id, license_id, product, machine_fingerprint, hostname,
  //   agent_version, local_account_count, running_task_count, status,
  //   last_seen_at, created_at, updated_at)
  if (existingDev) {
    await env.DB.prepare(
      `UPDATE agent_devices
         SET hostname = ?1, agent_version = ?2, status = 'online',
             last_seen_at = ?3, updated_at = ?3
         WHERE id = ?4`
    ).bind(hostname, agentVersion, nowIso(), existingDev.id).run();
  } else {
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO agent_devices
         (id, license_id, product, machine_fingerprint, hostname, agent_version,
          local_account_count, running_task_count, status,
          last_seen_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 'online', ?7, ?7, ?7)`
    ).bind(uuid(), lic.id, PRODUCT, machineFingerprint, hostname, agentVersion, now).run();
  }

  // sign agent token (carries user id when authenticated)
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + AGENT_TOKEN_TTL_SEC;
  const agentToken = await signAgentToken(env, {
    lid: lic.id,
    mfp: machineFingerprint,
    uid: user?.id ?? null,
    iat,
    exp,
  });

  await audit(env, isFirstBind ? 'license.activate.first' : 'license.activate.refresh',
    'license', lic.id, 'agent', {
      hostname, agentVersion, userId: user?.id ?? null,
    });

  return jsonResp({
    ok: true,
    licenseId: lic.id,
    tenantName: lic.tenant_name,
    plan: lic.plan,
    maxAccounts: lic.max_accounts,
    expiresAt: lic.expires_at,
    userEmail: user ? email : null,
    userRole: user?.role ?? null,
    agentToken,
    agentTokenExpiresAt: new Date(exp * 1000).toISOString(),
    firstBind: isFirstBind,
  });
}

// POST /license/verify
async function verify(body, env) {
  const token = body?.agentToken;
  const payload = await verifyAgentToken(env, token);
  if (!payload?.lid) return jsonResp({ ok: false, error: 'invalid_token' }, 401);

  const lic = await env.DB.prepare(
    `SELECT l.*, t.tenant_name AS tenant_name
     FROM licenses l
     LEFT JOIN tenants t ON t.id = l.tenant_id
     WHERE l.id = ?1 AND l.product = ?2`
  ).bind(payload.lid, PRODUCT).first();

  if (!lic) return jsonResp({ ok: false, error: 'license_not_found' }, 404);
  if (lic.status !== 'active') return jsonResp({ ok: false, error: `license_${lic.status}` }, 403);
  if (lic.expires_at && Date.parse(lic.expires_at) <= Date.now()) {
    return jsonResp({ ok: false, error: 'license_expired' }, 403);
  }
  // payload.mfp must still match current bound machine (defense against token replay after unbind+rebind)
  if (lic.machine_fingerprint && payload.mfp && lic.machine_fingerprint !== payload.mfp) {
    return jsonResp({ ok: false, error: 'machine_mismatch' }, 409);
  }

  // If the token was issued for a user, ensure the user is still active.
  let userRow = null;
  if (payload.uid) {
    userRow = await env.DB.prepare(
      `SELECT id, email, role, status FROM tenant_users WHERE id = ?1 AND tenant_id = ?2`
    ).bind(payload.uid, lic.tenant_id).first();
    if (!userRow) return jsonResp({ ok: false, error: 'user_not_found' }, 403);
    if (userRow.status !== 'active') return jsonResp({ ok: false, error: `user_${userRow.status}` }, 403);
  }

  await env.DB.prepare(`UPDATE licenses SET last_verified_at = ?1, updated_at = ?1 WHERE id = ?2`)
    .bind(nowIso(), lic.id).run();

  return jsonResp({
    ok: true,
    licenseId: lic.id,
    tenantName: lic.tenant_name,
    plan: lic.plan,
    maxAccounts: lic.max_accounts,
    expiresAt: lic.expires_at,
    userEmail: userRow?.email ?? null,
    userRole: userRow?.role ?? null,
  });
}

// POST /agents/heartbeat
async function heartbeat(body, env) {
  const token = body?.agentToken;
  const payload = await verifyAgentToken(env, token);
  if (!payload?.lid || !payload?.mfp) return jsonResp({ ok: false, error: 'invalid_token' }, 401);

  // accept counts but cap them defensively
  const localAccountCount = clampInt(body?.localAccountCount, 0, 100000);
  const runningTaskCount  = clampInt(body?.runningTaskCount,  0, 100000);
  const agentVersion      = body?.agentVersion == null ? null : String(body.agentVersion).slice(0, 50);

  const dev = await env.DB.prepare(
    `SELECT id FROM agent_devices WHERE license_id = ?1 AND machine_fingerprint = ?2`
  ).bind(payload.lid, payload.mfp).first();

  if (!dev) return jsonResp({ ok: false, error: 'device_not_found' }, 404);

  await env.DB.prepare(
    `UPDATE agent_devices
       SET status = 'online',
           local_account_count = ?1,
           running_task_count  = ?2,
           agent_version       = COALESCE(?3, agent_version),
           last_seen_at        = ?4,
           updated_at          = ?4
       WHERE id = ?5`
  ).bind(localAccountCount, runningTaskCount, agentVersion, nowIso(), dev.id).run();

  return jsonResp({ ok: true, serverTime: nowIso() });
}

// ─── Admin: change plan (and re-derive maxAccounts) ──────────────────────
async function adminChangePlan(body, env, id) {
  const planRaw = String(body?.plan ?? '').trim().toLowerCase();
  if (!PLAN_MAX_ACCOUNTS[planRaw]) {
    return jsonResp({ ok: false, error: 'invalid_plan', allowed: Object.keys(PLAN_MAX_ACCOUNTS) }, 400);
  }
  const lic = await env.DB.prepare(`SELECT id, plan, max_accounts FROM licenses WHERE id = ?1`).bind(id).first();
  if (!lic) return jsonResp({ ok: false, error: 'license_not_found' }, 404);

  const newMax = PLAN_MAX_ACCOUNTS[planRaw];
  await env.DB.prepare(
    `UPDATE licenses SET plan = ?1, max_accounts = ?2, updated_at = ?3 WHERE id = ?4`
  ).bind(planRaw, newMax, nowIso(), id).run();
  await audit(env, 'license.change_plan', 'license', id, 'admin', {
    oldPlan: lic.plan, newPlan: planRaw, oldMax: lic.max_accounts, newMax,
  });
  return jsonResp({ ok: true, id, plan: planRaw, maxAccounts: newMax });
}

// ─── Admin: attach a user to an existing tenant ──────────────────────────
async function adminAttachUser(body, env, tenantId) {
  const email    = body?.email == null ? null : normEmail(body.email);
  const password = body?.password == null ? null : String(body.password);
  const role     = body?.role == null ? 'admin' : String(body.role).toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) return jsonResp({ ok: false, error: 'email_invalid' }, 400);
  if (!password || password.length < PWD_MIN_LEN) {
    return jsonResp({ ok: false, error: 'password_too_short', minLength: PWD_MIN_LEN }, 400);
  }
  if (!isValidRole(role)) return jsonResp({ ok: false, error: 'invalid_role' }, 400);

  const tenant = await env.DB.prepare(`SELECT id, tenant_name FROM tenants WHERE id = ?1 AND product = ?2`)
    .bind(tenantId, PRODUCT).first();
  if (!tenant) return jsonResp({ ok: false, error: 'tenant_not_found' }, 404);

  const existing = await env.DB.prepare(
    `SELECT id FROM tenant_users WHERE tenant_id = ?1 AND lower(email) = lower(?2)`
  ).bind(tenantId, email).first();
  if (existing) return jsonResp({ ok: false, error: 'email_already_exists' }, 409);

  const userId = uuid();
  const now = nowIso();
  const passwordHashed = await passwordHash(password, env);
  await env.DB.prepare(
    `INSERT INTO tenant_users
       (id, tenant_id, email, password_hash, role, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`
  ).bind(userId, tenantId, email, passwordHashed, role, now).run();
  await audit(env, 'user.create', 'user', userId, 'admin', { tenantId, email, role });
  return jsonResp({ ok: true, id: userId, tenantId, email, role });
}

// ─── Admin: reset user password (returns new temp password ONCE) ─────────
async function adminResetUserPwd(_body, env, userId) {
  const u = await env.DB.prepare(`SELECT id, tenant_id, email FROM tenant_users WHERE id = ?1`).bind(userId).first();
  if (!u) return jsonResp({ ok: false, error: 'user_not_found' }, 404);
  const temp = generateTempPassword();
  const hashed = await passwordHash(temp, env);
  await env.DB.prepare(`UPDATE tenant_users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(hashed, nowIso(), userId).run();
  await audit(env, 'user.reset_password', 'user', userId, 'admin', { tenantId: u.tenant_id });
  return jsonResp({
    ok: true,
    id: userId,
    email: u.email,
    tempPassword: temp,
    note: 'Deliver this temporary password to the user securely. It is shown only once.',
  });
}

// ─── Admin: enable / disable user ────────────────────────────────────────
async function adminSetUserStatus(_body, env, userId, status) {
  const u = await env.DB.prepare(`SELECT id, tenant_id FROM tenant_users WHERE id = ?1`).bind(userId).first();
  if (!u) return jsonResp({ ok: false, error: 'user_not_found' }, 404);
  await env.DB.prepare(`UPDATE tenant_users SET status = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(status, nowIso(), userId).run();
  await audit(env, 'user.set_status', 'user', userId, 'admin', { tenantId: u.tenant_id, status });
  return jsonResp({ ok: true, id: userId, status });
}

// ─── Admin: list users (no password_hash, no token) ──────────────────────
async function adminListUsers(env) {
  const rs = await env.DB.prepare(
    `SELECT u.id, u.tenant_id, u.email, u.role, u.status, u.created_at, u.updated_at,
            t.tenant_name
       FROM tenant_users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
      ORDER BY u.created_at DESC`
  ).all();
  const users = (rs?.results ?? []).map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    email: r.email,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return jsonResp({ ok: true, count: users.length, users });
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
