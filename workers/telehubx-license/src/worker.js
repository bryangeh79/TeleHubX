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
      if (route === 'GET /health')             return health(env);
      if (route === 'POST /license/activate')  return jsonRoute(request, env, activate);
      if (route === 'POST /license/verify')    return jsonRoute(request, env, verify);
      if (route === 'POST /agents/heartbeat')  return jsonRoute(request, env, heartbeat);

      // ── admin (require Bearer ADMIN_TOKEN) ─────────────────────
      if (url.pathname.startsWith('/admin/')) {
        const adminCheck = requireAdmin(request, env);
        if (adminCheck) return adminCheck;

        if (route === 'POST /admin/licenses/create') return jsonRoute(request, env, adminCreateLicense);
        if (route === 'GET  /admin/licenses' || route === 'GET /admin/licenses') return adminListLicenses(env);

        // /admin/licenses/:id/{revoke|extend|unbind}
        const m = url.pathname.match(/^\/admin\/licenses\/([^/]+)\/(revoke|extend|unbind)$/);
        if (m && request.method === 'POST') {
          const [, id, op] = m;
          if (op === 'revoke') return jsonRoute(request, env, (b, e) => adminRevoke(b, e, id));
          if (op === 'extend') return jsonRoute(request, env, (b, e) => adminExtend(b, e, id));
          if (op === 'unbind') return jsonRoute(request, env, (b, e) => adminUnbind(b, e, id));
        }
      }

      return jsonResp({ ok: false, error: 'not_found' }, 404);
    } catch (err) {
      // never leak secrets / stack
      return jsonResp({ ok: false, error: 'server_error', message: String(err?.message ?? err).slice(0, 200) }, 500);
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
async function audit(env, action, targetType, targetId, actor, meta) {
  await env.DB.prepare(
    `INSERT INTO audit_logs (id, action, target_type, target_id, actor, meta, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(uuid(), action, targetType ?? null, targetId ?? null, actor ?? null,
         meta ? JSON.stringify(meta) : null, nowIso())
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
async function adminCreateLicense(body, env) {
  const tenantName = String(body?.tenantName ?? '').trim();
  const contact    = body?.contact == null ? null : String(body.contact).trim();
  const planRaw    = String(body?.plan ?? '').trim().toLowerCase();
  const expiresAt  = body?.expiresAt == null ? null : String(body.expiresAt);

  if (!tenantName) return jsonResp({ ok: false, error: 'tenantName_required' }, 400);
  if (!PLAN_MAX_ACCOUNTS[planRaw]) {
    return jsonResp({ ok: false, error: 'invalid_plan', allowed: Object.keys(PLAN_MAX_ACCOUNTS) }, 400);
  }
  // Server-side source of truth — ignore client-supplied maxAccounts
  const maxAccounts = PLAN_MAX_ACCOUNTS[planRaw];

  // 1) tenant
  const tenantId = uuid();
  await env.DB.prepare(
    `INSERT INTO tenants (id, name, contact, created_at) VALUES (?1, ?2, ?3, ?4)`
  ).bind(tenantId, tenantName, contact, nowIso()).run();

  // 2) license key (one-time plaintext returned)
  const licenseKey = generateLicenseKey();
  const licenseKeyHash = await hashLicenseKey(licenseKey, env);
  const licenseKeySuffix = licenseKey.slice(-4);

  const licenseId = uuid();
  await env.DB.prepare(
    `INSERT INTO licenses
       (id, tenant_id, product, plan, max_accounts, license_key_hash, license_key_suffix,
        status, expires_at, machine_fingerprint, activated_at, last_verified_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, NULL, NULL, NULL, ?9)`
  ).bind(licenseId, tenantId, PRODUCT, planRaw, maxAccounts,
         licenseKeyHash, licenseKeySuffix, expiresAt, nowIso())
   .run();

  await audit(env, 'license.create', 'license', licenseId, 'admin', {
    tenantName, plan: planRaw, maxAccounts, expiresAt,
  });

  return jsonResp({
    ok: true,
    licenseId,
    tenantId,
    tenantName,
    plan: planRaw,
    maxAccounts,
    expiresAt,
    licenseKey,                                       // ← only returned ONCE
    note: 'Store this license key safely — it is not retrievable again.',
  });
}

// GET /admin/licenses
async function adminListLicenses(env) {
  const rs = await env.DB.prepare(
    `SELECT
       l.id              AS id,
       l.tenant_id       AS tenant_id,
       t.name            AS tenant_name,
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

  await env.DB.prepare(`UPDATE licenses SET status = 'revoked' WHERE id = ?1`).bind(id).run();
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

  await env.DB.prepare(`UPDATE licenses SET expires_at = ?1 WHERE id = ?2`)
    .bind(String(newExpiresAt), id).run();
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

  await env.DB.prepare(`UPDATE licenses SET machine_fingerprint = NULL WHERE id = ?1`).bind(id).run();
  await audit(env, 'license.unbind', 'license', id, 'admin', {
    previousMachineFingerprint: lic.machine_fingerprint,
  });
  return jsonResp({ ok: true, id, unbound: true });
}

// POST /license/activate
async function activate(body, env) {
  const licenseKey = String(body?.licenseKey ?? '').trim();
  const machineFingerprint = String(body?.machineFingerprint ?? '').trim();
  const hostname = body?.hostname == null ? null : String(body.hostname).slice(0, 200);
  const agentVersion = body?.agentVersion == null ? null : String(body.agentVersion).slice(0, 50);

  if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) {
    return jsonResp({ ok: false, error: 'invalid_key_format' }, 400);
  }
  if (!machineFingerprint) {
    return jsonResp({ ok: false, error: 'machineFingerprint_required' }, 400);
  }

  const hash = await hashLicenseKey(licenseKey, env);
  const lic = await env.DB.prepare(
    `SELECT l.*, t.name AS tenant_name
     FROM licenses l
     LEFT JOIN tenants t ON t.id = l.tenant_id
     WHERE l.license_key_hash = ?1 AND l.product = ?2`
  ).bind(hash, PRODUCT).first();

  if (!lic) return jsonResp({ ok: false, error: 'license_not_found' }, 404);
  if (lic.status !== 'active') return jsonResp({ ok: false, error: `license_${lic.status}` }, 403);
  if (lic.expires_at && Date.parse(lic.expires_at) <= Date.now()) {
    return jsonResp({ ok: false, error: 'license_expired' }, 403);
  }

  // bind / verify machine
  if (lic.machine_fingerprint && lic.machine_fingerprint !== machineFingerprint) {
    await audit(env, 'license.activate.reject_mismatch', 'license', lic.id, 'agent', {
      hostname, agentVersion,
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
         SET machine_fingerprint = ?1, activated_at = ?2
         WHERE id = ?3`
    ).bind(machineFingerprint, nowIso(), lic.id).run();
  }

  // upsert agent_devices row (1 device per license)
  const existingDev = await env.DB.prepare(
    `SELECT id FROM agent_devices WHERE license_id = ?1 AND machine_fingerprint = ?2`
  ).bind(lic.id, machineFingerprint).first();

  if (existingDev) {
    await env.DB.prepare(
      `UPDATE agent_devices
         SET hostname = ?1, agent_version = ?2, status = 'online',
             last_seen_at = ?3
         WHERE id = ?4`
    ).bind(hostname, agentVersion, nowIso(), existingDev.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO agent_devices
         (id, license_id, machine_fingerprint, hostname, agent_version, status,
          local_account_count, running_task_count, last_seen_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'online', 0, 0, ?6, ?6)`
    ).bind(uuid(), lic.id, machineFingerprint, hostname, agentVersion, nowIso()).run();
  }

  // sign agent token
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + AGENT_TOKEN_TTL_SEC;
  const agentToken = await signAgentToken(env, { lid: lic.id, mfp: machineFingerprint, iat, exp });

  await audit(env, isFirstBind ? 'license.activate.first' : 'license.activate.refresh',
    'license', lic.id, 'agent', { hostname, agentVersion });

  return jsonResp({
    ok: true,
    licenseId: lic.id,
    tenantName: lic.tenant_name,
    plan: lic.plan,
    maxAccounts: lic.max_accounts,
    expiresAt: lic.expires_at,
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
    `SELECT l.*, t.name AS tenant_name
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

  await env.DB.prepare(`UPDATE licenses SET last_verified_at = ?1 WHERE id = ?2`)
    .bind(nowIso(), lic.id).run();

  return jsonResp({
    ok: true,
    licenseId: lic.id,
    tenantName: lic.tenant_name,
    plan: lic.plan,
    maxAccounts: lic.max_accounts,
    expiresAt: lic.expires_at,
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
           last_seen_at        = ?4
       WHERE id = ?5`
  ).bind(localAccountCount, runningTaskCount, agentVersion, nowIso(), dev.id).run();

  return jsonResp({ ok: true, serverTime: nowIso() });
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
