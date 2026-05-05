-- TeleHubX License Worker — D1 schema (expected by src/worker.js)
--
-- The 4 tables already exist in the manually-created `telehubx-license-db`
-- database. This file is the canonical reference; run the CREATE statements
-- only on a fresh database. The ALTER statements at the bottom are safe
-- patches if your existing tables are missing newer columns.
--
-- All column names match what worker.js binds. If a column already exists
-- with a different name, either rename the column (D1 supports
-- `ALTER TABLE … RENAME COLUMN`) or update worker.js to match — but keep
-- the names consistent across both sides.

-- ─── tenants ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  contact     TEXT,
  created_at  TEXT NOT NULL
);

-- ─── licenses ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  product               TEXT NOT NULL DEFAULT 'telehubx',
  plan                  TEXT NOT NULL,                  -- basic | pro | enterprise
  max_accounts          INTEGER NOT NULL,
  license_key_hash      TEXT NOT NULL UNIQUE,           -- SHA-256(licenseKey + LICENSE_PEPPER)
  license_key_suffix    TEXT NOT NULL,                  -- last 4 chars for masked display
  status                TEXT NOT NULL DEFAULT 'active', -- active | revoked | suspended
  expires_at            TEXT,
  machine_fingerprint   TEXT,
  activated_at          TEXT,
  last_verified_at      TEXT,
  created_at            TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_licenses_tenant         ON licenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status         ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_product_status ON licenses(product, status);

-- ─── agent_devices ──────────────────────────────────────────────────────
-- One row per (license, machine_fingerprint). Updated by activate +
-- heartbeat. Historical rows are kept after admin unbind for audit.
CREATE TABLE IF NOT EXISTS agent_devices (
  id                   TEXT PRIMARY KEY,
  license_id           TEXT NOT NULL,
  machine_fingerprint  TEXT NOT NULL,
  hostname             TEXT,
  agent_version        TEXT,
  status               TEXT,                             -- online | offline
  local_account_count  INTEGER DEFAULT 0,
  running_task_count   INTEGER DEFAULT 0,
  last_seen_at         TEXT,
  created_at           TEXT NOT NULL,
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE INDEX IF NOT EXISTS idx_devices_license         ON agent_devices(license_id);
CREATE INDEX IF NOT EXISTS idx_devices_license_fp      ON agent_devices(license_id, machine_fingerprint);

-- ─── audit_logs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  action       TEXT NOT NULL,        -- license.create | license.revoke | license.activate.first | …
  target_type  TEXT,                 -- license | tenant | device
  target_id    TEXT,
  actor        TEXT,                 -- admin | agent | system
  meta         TEXT,                 -- JSON blob (small)
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action);

-- ─── safe ALTERs (run only if your existing schema is missing columns) ──
-- D1's `ALTER TABLE … ADD COLUMN` is idempotent only if you wrap it in your
-- own check; sqlite has no `IF NOT EXISTS` for ADD COLUMN. The statements
-- below are commented out — uncomment as needed after inspecting `.schema`.
--
-- ALTER TABLE licenses       ADD COLUMN license_key_suffix TEXT;
-- ALTER TABLE licenses       ADD COLUMN last_verified_at   TEXT;
-- ALTER TABLE agent_devices  ADD COLUMN local_account_count INTEGER DEFAULT 0;
-- ALTER TABLE agent_devices  ADD COLUMN running_task_count  INTEGER DEFAULT 0;
-- ALTER TABLE agent_devices  ADD COLUMN agent_version        TEXT;
