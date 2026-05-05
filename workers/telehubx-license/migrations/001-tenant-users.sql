-- TeleHubX License Worker — migration 001
-- Adds tenant_users table for per-tenant login (email + password).
--
-- Safe to run on the existing production D1 (telehubx-license-db) — uses
-- IF NOT EXISTS so re-running is a no-op. Existing tenants/licenses are
-- untouched. To attach a first admin user to an already-existing tenant,
-- call:
--
--   POST /admin/tenants/:tenantId/users
--   Authorization: Bearer <ADMIN_TOKEN>
--   { "email": "...", "password": "...", "role": "admin" }
--
-- (handled by worker.js; see README "Attach a user to an existing tenant").

CREATE TABLE IF NOT EXISTS tenant_users (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin',
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_users_tenant_email
  ON tenant_users(tenant_id, lower(email));
