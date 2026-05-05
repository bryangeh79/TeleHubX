# TeleHubX License Worker

A Cloudflare Worker that handles **only** TeleHubX license issuance,
activation, verification, and agent heartbeat. **No** Telegram sessions,
proxy credentials, campaigns, tasks, leads, materials, or business data
are stored or proxied here.

- **Worker name:** `telehubx-license`
- **Custom domain:** `https://telehubx-license.starbright-solutions.com`
- **D1 database:** `telehubx-license-db` (binding name `DB`)
- **Worker secrets:** `ADMIN_TOKEN`, `LICENSE_PEPPER`, `AGENT_TOKEN_SECRET`
- **Product:** locked to `telehubx`
- **License key prefix:** locked to `THX-`

---

## Files

| File | Purpose |
|---|---|
| `src/worker.js` | Entire Worker — routes, license signing, agent token (HMAC-SHA256) |
| `wrangler.toml` | Wrangler deploy config (D1 binding, optional route) |
| `schema.sql` | Reference D1 schema — already created in production; only run on a fresh DB |
| `README.md` | This file — deploy + curl tests + admin notes |

---

## Routes

### Public / agent

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Health check + DB binding probe |
| `POST` | `/license/activate` | license key in body | First-time bind machine, returns `agentToken` |
| `POST` | `/license/verify` | `agentToken` in body | Periodic re-check; returns plan/maxAccounts/expiresAt |
| `POST` | `/agents/heartbeat` | `agentToken` in body | Mark device online + report counts |

### Admin (require `Authorization: Bearer <ADMIN_TOKEN>`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin/licenses/create` | Create tenant + license; returns plaintext key once |
| `GET`  | `/admin/licenses` | List all licenses (masked key, no hash) |
| `POST` | `/admin/licenses/:id/revoke` | Revoke a license (status → `revoked`) |
| `POST` | `/admin/licenses/:id/extend` | Update `expires_at` |
| `POST` | `/admin/licenses/:id/unbind` | Clear `machine_fingerprint` so a new machine can rebind |

---

## Deployment

### Option A — Cloudflare dashboard "Edit Code"

1. Open Workers → `telehubx-license` → Edit Code.
2. Replace the editor contents with `src/worker.js`.
3. Confirm the D1 binding name is `DB` (Settings → Variables and Secrets →
   D1 Bindings).
4. Confirm the three secrets exist (Settings → Variables and Secrets →
   Secrets): `ADMIN_TOKEN`, `LICENSE_PEPPER`, `AGENT_TOKEN_SECRET`.
5. Save and Deploy.
6. Sanity check: `curl https://telehubx-license.starbright-solutions.com/health`

### Option B — Wrangler CLI

```bash
cd workers/telehubx-license

# 1) put the real D1 database id in wrangler.toml
# 2) (only if not already set in dashboard)
wrangler secret put ADMIN_TOKEN
wrangler secret put LICENSE_PEPPER
wrangler secret put AGENT_TOKEN_SECRET

# 3) deploy
wrangler deploy
```

The custom domain `telehubx-license.starbright-solutions.com` is already
mapped in the dashboard, so a simple `wrangler deploy` is enough — no
route block is required in `wrangler.toml`.

---

## API tests (curl)

Replace `WORKER` and `ADMIN_TOKEN` first:

```bash
WORKER=https://telehubx-license.starbright-solutions.com
ADMIN_TOKEN=<your-admin-token>
```

### 1. health

```bash
curl -s "$WORKER/health" | jq
# → { "ok": true, "service": "telehubx-license", "product": "telehubx",
#     "dbBound": true, "time": "..." }
```

### 2. create license (admin)

```bash
curl -s -X POST "$WORKER/admin/licenses/create" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "tenantName": "ABC Customer",
    "contact": "customer@example.com",
    "plan": "pro",
    "expiresAt": "2026-12-31T23:59:59Z"
  }' | jq
# → { "ok": true, "licenseId": "...", "tenantId": "...", "plan": "pro",
#     "maxAccounts": 30, "expiresAt": "...",
#     "licenseKey": "THX-XXXX-XXXX-XXXX",   ← copy this immediately
#     "note": "..." }
```

> The plaintext `licenseKey` is returned **once and only once**. Store it
> in your admin records and hand it to the customer.

### 3. list licenses (admin)

```bash
curl -s "$WORKER/admin/licenses" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### 4. activate (local agent, first-time bind)

```bash
curl -s -X POST "$WORKER/license/activate" \
  -H 'content-type: application/json' \
  -d '{
    "licenseKey": "THX-XXXX-XXXX-XXXX",
    "machineFingerprint": "machine_abc123",
    "hostname": "Customer-PC",
    "agentVersion": "1.0.0"
  }' | jq
# → { "ok": true, "licenseId": "...", "tenantName": "...", "plan": "pro",
#     "maxAccounts": 30, "expiresAt": "...",
#     "agentToken": "eyJ...",  ← store locally and reuse for verify/heartbeat
#     "agentTokenExpiresAt": "...",
#     "firstBind": true }
```

### 5. verify (agent)

```bash
curl -s -X POST "$WORKER/license/verify" \
  -H 'content-type: application/json' \
  -d '{ "agentToken": "<paste agentToken>" }' | jq
```

### 6. heartbeat (agent)

```bash
curl -s -X POST "$WORKER/agents/heartbeat" \
  -H 'content-type: application/json' \
  -d '{
    "agentToken": "<paste agentToken>",
    "localAccountCount": 26,
    "runningTaskCount": 4,
    "agentVersion": "1.0.0"
  }' | jq
# → { "ok": true, "serverTime": "..." }
```

### 7. revoke / extend / unbind (admin)

```bash
LIC_ID=<licenseId from create>

# revoke
curl -s -X POST "$WORKER/admin/licenses/$LIC_ID/revoke" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# extend (push expiry out)
curl -s -X POST "$WORKER/admin/licenses/$LIC_ID/extend" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{ "expiresAt": "2027-12-31T23:59:59Z" }' | jq

# unbind (so a new machine can take over on next /license/activate)
curl -s -X POST "$WORKER/admin/licenses/$LIC_ID/unbind" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

---

## Admin: how to issue a new tenant + license

1. Decide tenant name, contact, plan (`basic` / `pro` / `enterprise`),
   and optional `expiresAt` (ISO string, e.g. `2026-12-31T23:59:59Z`).
2. Call `POST /admin/licenses/create` once.
3. Copy the returned `licenseKey` (`THX-XXXX-XXXX-XXXX`) and deliver it
   to the customer through a secure channel.
4. The customer pastes the key into local TeleHubX during first run; the
   local agent calls `/license/activate` and the machine becomes bound.
5. Going forward the local agent calls `/license/verify` (e.g. every 30
   minutes) and `/agents/heartbeat` (e.g. every 60 seconds).
6. If the customer changes machines, run `/admin/licenses/:id/unbind`,
   then they can re-activate from the new machine.

---

## Behaviour notes

- **Plan / maxAccounts** is server-derived from the `plan` value
  (`basic` → 10, `pro` → 30, `enterprise` → 50). Any client-supplied
  `maxAccounts` is intentionally ignored to keep the platform as the
  single source of truth.
- **License key hash** is `SHA-256(licenseKey + ":" + LICENSE_PEPPER)`,
  stored hex-encoded in `licenses.license_key_hash`. The plaintext key is
  **never** stored. Only `license_key_suffix` (last 4 chars) is kept for
  masked display in the admin list.
- **Agent token** is a compact JWT-like blob signed with
  `AGENT_TOKEN_SECRET` (HMAC-SHA256). Payload = `{ lid, mfp, iat, exp }`.
  Default TTL is 7 days; agents should re-`activate` (or refresh through a
  future endpoint) after expiry. Until then `/license/verify` and
  `/agents/heartbeat` accept the same token.
- **Machine binding** happens on the first `/license/activate`. Any later
  activation from a different machine is rejected with `409 machine_mismatch`
  until an admin runs `/admin/licenses/:id/unbind`.
- **Audit log**: every admin write and every activation attempt
  (success/reject) writes to `audit_logs`. Failures to write the audit
  row never abort the primary operation.
- **CORS** is intentionally not enabled. Admin should be called from a
  trusted local/admin context (curl, server-side, or a private admin
  tool) — not from a public website with the token in the browser.

---

## Safety confirmation

This Worker stores and processes **only**:

| Stored | Why |
|---|---|
| `tenants(name, contact)` | Bookkeeping for license owner |
| `licenses(plan, maxAccounts, hash, suffix, status, expiresAt, machineFingerprint, activatedAt, lastVerifiedAt)` | License lifecycle |
| `agent_devices(hostname, agentVersion, status, localAccountCount, runningTaskCount, lastSeenAt)` | Heartbeat for "is this customer alive" |
| `audit_logs(action, targetType, targetId, actor, meta)` | Admin / activation audit trail |

This Worker **never** stores, proxies, or sees:

- Telegram sessions / api_id / api_hash / phone numbers
- Proxy host / port / username / password
- Campaign content / message text / leads / customer chats
- AI keys (OpenAI / DeepSeek / Gemini etc.)
- KB content / FAQ / assets / scripts
- Anything tenant-business beyond name + contact

If a future change ever needs to add another field, it should be reviewed
against this allow-list first.
