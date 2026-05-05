-- TeleHubX License Worker — D1 schema (canonical, matches production)
--
-- These 4 tables already exist in the manually-created `telehubx-license-db`
-- database and are the schema worker.js is built against. This file is the
-- canonical reference; only run the CREATE statements on a fresh database.

-- ─── tenants ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id           TEXT PRIMARY KEY,
  product      TEXT NOT NULL,                  -- always 'telehubx' for this worker
  tenant_name  TEXT NOT NULL,
  contact      TEXT,
  status       TEXT NOT NULL DEFAULT 'active', -- active | suspended
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- ─── licenses ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  product               TEXT NOT NULL,                  -- always 'telehubx'
  license_key_hash      TEXT NOT NULL UNIQUE,           -- SHA-256(licenseKey + ':' + LICENSE_PEPPER), hex
  license_key_suffix    TEXT NOT NULL,                  -- last 4 chars for masked display
  plan                  TEXT NOT NULL,                  -- basic | pro | enterprise
  max_accounts          INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active', -- active | revoked | suspended
  expires_at            TEXT,
  machine_fingerprint   TEXT,
  activated_at          TEXT,
  last_verified_at      TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_licenses_tenant         ON licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status         ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_product_status ON licenses(product, status);

-- ─── agent_devices ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_devices (
  id                   TEXT PRIMARY KEY,
  license_id           TEXT NOT NULL,
  product              TEXT NOT NULL,                   -- always 'telehubx'
  machine_fingerprint  TEXT NOT NULL,
  hostname             TEXT,
  agent_version        TEXT,
  local_account_count  INTEGER DEFAULT 0,
  running_task_count   INTEGER DEFAULT 0,
  status               TEXT,                            -- online | offline
  last_seen_at         TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE INDEX IF NOT EXISTS idx_devices_license    ON agent_devices(license_id);
CREATE INDEX IF NOT EXISTS idx_devices_license_fp ON agent_devices(license_id, machine_fingerprint);

-- ─── tenant_users ───────────────────────────────────────────────────────
-- Per-tenant login users used by the local TeleHubX activation form.
-- Email is unique within a tenant. Passwords are stored as
-- pbkdf2$iter$saltB64$hashB64  using USER_PASSWORD_PEPPER as a static
-- pepper (mixed into the password input before key derivation).
CREATE TABLE IF NOT EXISTS tenant_users (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin',  -- admin | operator | viewer
  status         TEXT NOT NULL DEFAULT 'active', -- active | disabled
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_users_tenant_email
  ON tenant_users(tenant_id, lower(email));

-- ─── audit_logs ─────────────────────────────────────────────────────────
-- Production schema is intentionally tight: target_type is encoded inside
-- detail_json.targetType so that the column doesn't need to exist.
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  actor        TEXT,                  -- admin | agent | system
  action       TEXT NOT NULL,         -- license.create | license.revoke | license.activate.first | …
  target_id    TEXT,
  detail_json  TEXT,                  -- JSON blob (small) — includes targetType
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action);
