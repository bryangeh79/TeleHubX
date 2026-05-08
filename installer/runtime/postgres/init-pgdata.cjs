#!/usr/bin/env node
/**
 * Postgres Portable initialization — TRULY idempotent (Issue #14 vmfix6).
 *
 * Spawned by supervisor before postgres long-run.
 *
 * Covers all real-world install states found during VM testing:
 *   State A  fresh AppData                       -> initdb + createdb + vector
 *   State B  pgdata exists, database missing     -> createdb + vector  (was: skipped, BUG)
 *   State C  database exists, vector missing     -> CREATE EXTENSION vector
 *   State D  schema not migrated                 -> server's TypeORM does it; we just verify connectivity
 *   State E  half-init / interrupted prior run   -> repair (continue from where it broke)
 *   State F  prior temp postgres / init script residue -> ensure clean exit
 *
 * Lifecycle guarantees:
 *   - Every external command has a hard timeout (no infinite hang)
 *   - psql -w (no interactive password prompt)
 *   - Temporary postgres always stopped via try/finally + signal handlers
 *   - Process exits 0 on success, non-zero on failure
 *   - No orphan processes left behind
 *
 * env (supervisor passes all of these via subprocessEnv()):
 *   TELEHUBX_INSTALL_PATH    runtime/postgres/bin parent
 *   TELEHUBX_DATA_DIR        pgdata parent
 *   PG_PORT                  port (default 5436)
 *   PG_USER                  app user (default telehubx)
 *   PG_PASSWORD              app password (default telehubx)
 *   PG_DATABASE              db name (default telehubx)
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function expandWinVars(s) {
  return s.replace(/%([^%]+)%/g, (_, k) => process.env[k] || '');
}

const installPath = process.env.TELEHUBX_INSTALL_PATH
  ? path.resolve(process.env.TELEHUBX_INSTALL_PATH)
  : path.resolve(__dirname, '..', '..');

const dataDir = path.resolve(
  expandWinVars(process.env.TELEHUBX_DATA_DIR || path.join(installPath, 'data'))
);
const pgdataDir = path.join(dataDir, 'pgdata');

const PG_PORT = process.env.PG_PORT || process.env.DB_PORT || '5436';
const PG_USER = process.env.PG_USER || process.env.DB_USER || 'telehubx';
const PG_PASSWORD = process.env.PG_PASSWORD || process.env.DB_PASSWORD || 'telehubx';
const PG_DATABASE = process.env.PG_DATABASE || process.env.DB_NAME || 'telehubx';

const pgBin = path.join(installPath, 'runtime', 'postgres', 'bin');
const initdbExe = path.join(pgBin, 'initdb.exe');
const pgCtlExe = path.join(pgBin, 'pg_ctl.exe');
const psqlExe = path.join(pgBin, 'psql.exe');

function log(msg) { console.log(`[init-pgdata] ${msg}`); }
function fail(msg) { console.error(`[init-pgdata] FATAL: ${msg}`); cleanupAndExit(2); }

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function run(exe, args, opts = {}) {
  return spawnSync(exe, args, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

// psql via TCP needs PGPASSWORD because --auth-host=scram-sha-256.
function runPsql(args, opts = {}) {
  return spawnSync(psqlExe, args, {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    ...opts,
  });
}

// Track whether we've started a temporary postgres so cleanup knows to stop it.
let tempPostgresRunning = false;

function startTempPostgres() {
  log('starting postgres (temporary, for setup)...');
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  const r = run(pgCtlExe, [
    '-D', pgdataDir,
    '-l', path.join(dataDir, 'logs', 'postgres-init.log'),
    '-w', '-t', '60',
    'start',
  ]);
  if (r.status !== 0) {
    // Maybe postgres is already running from a prior interrupted init.
    // Check by trying psql.
    const probe = runPsql(['-w', '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', 'postgres', '-c', 'SELECT 1;']);
    if (probe.status === 0) {
      log('postgres already running on port ' + PG_PORT + ' — reusing');
      tempPostgresRunning = true;
      return;
    }
    fail(`pg_ctl start failed (status=${r.status}): ${(r.stderr || '').trim()}`);
  }
  tempPostgresRunning = true;
}

function stopTempPostgres() {
  if (!tempPostgresRunning) return;
  log('stopping temporary postgres (fast)...');
  let r = run(pgCtlExe, [
    '-D', pgdataDir,
    '-m', 'fast', '-w', '-t', '30',
    'stop',
  ]);
  if (r.status !== 0) {
    log(`fast stop failed (status=${r.status}): ${(r.stderr || '').trim()} — retrying with immediate`);
    r = run(pgCtlExe, [
      '-D', pgdataDir,
      '-m', 'immediate', '-w', '-t', '30',
      'stop',
    ]);
    if (r.status !== 0) {
      log(`immediate stop ALSO failed (status=${r.status}): ${(r.stderr || '').trim()}`);
      // postmaster.pid may be stuck; remove it so a fresh postgres can start.
      // We do NOT taskkill anything broadly — just clean the lock file.
      const pmPid = path.join(pgdataDir, 'postmaster.pid');
      try {
        fs.unlinkSync(pmPid);
        log(`removed stale ${pmPid}`);
      } catch { /* ignore */ }
      log('init-pgdata WARNING: temp postgres may still be running on port; ' +
          'supervisor will attempt port-occupant adoption');
    }
  }
  tempPostgresRunning = false;
}

function cleanupAndExit(code) {
  try { stopTempPostgres(); } catch { /* ignore */ }
  process.exit(code);
}

// Handle interruptions (Ctrl-C, kill from supervisor timeout) so we don't
// leave a temp postgres running.
process.on('SIGINT',  () => cleanupAndExit(130));
process.on('SIGTERM', () => cleanupAndExit(143));
process.on('uncaughtException', (e) => {
  console.error(`[init-pgdata] FATAL: uncaught: ${e && e.stack ? e.stack : e}`);
  cleanupAndExit(99);
});

// ============================================================================
// Phase 1: pgdata initialization (only if PG_VERSION missing)
// ============================================================================
const pgInitialized = exists(path.join(pgdataDir, 'PG_VERSION'));

if (!pgInitialized) {
  log(`pgdata not initialized — running initdb at ${pgdataDir}`);
  if (!exists(initdbExe)) fail(`initdb missing: ${initdbExe}`);
  if (!exists(pgCtlExe))  fail(`pg_ctl missing: ${pgCtlExe}`);
  if (!exists(psqlExe))   fail(`psql missing: ${psqlExe}`);

  fs.mkdirSync(dataDir, { recursive: true });

  const pwFile = path.join(os.tmpdir(), `telehubx-initpw-${process.pid}.txt`);
  fs.writeFileSync(pwFile, PG_PASSWORD, 'utf8');
  try {
    const r = run(initdbExe, [
      '-D', pgdataDir,
      '--username', PG_USER,
      '--pwfile', pwFile,
      '--encoding', 'UTF8',
      '--locale', 'C',
      '--auth-local', 'trust',
      '--auth-host', 'scram-sha-256',
    ]);
    if (r.status !== 0) fail(`initdb failed: ${(r.stderr || '').trim()}`);
  } finally {
    try { fs.unlinkSync(pwFile); } catch { /* ignore */ }
  }

  // Append our overrides to postgresql.conf
  const confPath = path.join(pgdataDir, 'postgresql.conf');
  let conf = fs.readFileSync(confPath, 'utf8');
  const overrides =
    "\n# TeleHubX overrides\n" +
    "listen_addresses = '127.0.0.1'\n" +
    `port = ${PG_PORT}\n` +
    "shared_preload_libraries = 'vector'\n";
  if (!conf.includes('# TeleHubX overrides')) {
    conf += overrides;
    fs.writeFileSync(confPath, conf, 'utf8');
    log(`postgresql.conf: listen=127.0.0.1 port=${PG_PORT}`);
  }
} else {
  log(`pgdata already initialized — verifying database/extension state`);
  // Ensure config overrides are present even on existing pgdata
  const confPath = path.join(pgdataDir, 'postgresql.conf');
  if (exists(confPath)) {
    const conf = fs.readFileSync(confPath, 'utf8');
    if (!conf.includes('# TeleHubX overrides')) {
      const overrides =
        "\n# TeleHubX overrides (added on retroactive verify)\n" +
        "listen_addresses = '127.0.0.1'\n" +
        `port = ${PG_PORT}\n` +
        "shared_preload_libraries = 'vector'\n";
      fs.writeFileSync(confPath, conf + overrides, 'utf8');
      log('appended missing TeleHubX overrides to postgresql.conf');
    }
  }
}

// ============================================================================
// Phase 2: Verify/repair database, user, extension
// Must work whether pgdata was just created OR is an existing (possibly
// half-initialized) install.
// ============================================================================

startTempPostgres();

try {
  // Step 2a: probe connectivity as superuser
  const ping = runPsql([
    '-w', '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', 'postgres',
    '-Atc', 'SELECT 1;',
  ]);
  if (ping.status !== 0) {
    fail(`cannot connect to postgres as ${PG_USER}: ${(ping.stderr || '').trim()}`);
  }
  log(`connected as ${PG_USER}@127.0.0.1:${PG_PORT}/postgres`);

  // Step 2b: ensure database exists  (REPAIRS State B)
  const dbExists = runPsql([
    '-w', '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', 'postgres',
    '-Atc', `SELECT 1 FROM pg_database WHERE datname='${PG_DATABASE}';`,
  ]);
  if ((dbExists.stdout || '').trim() === '1') {
    log(`database "${PG_DATABASE}" exists`);
  } else {
    log(`database "${PG_DATABASE}" missing — creating`);
    const createDb = runPsql([
      '-w', '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', 'postgres',
      '-c', `CREATE DATABASE ${PG_DATABASE} OWNER ${PG_USER};`,
    ]);
    if (createDb.status !== 0) {
      fail(`CREATE DATABASE failed: ${(createDb.stderr || '').trim()}`);
    }
    log(`database "${PG_DATABASE}" created`);
  }

  // Step 2c: ensure pgvector extension exists  (REPAIRS State C)
  const extExists = runPsql([
    '-w', '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', PG_DATABASE,
    '-Atc', "SELECT 1 FROM pg_extension WHERE extname='vector';",
  ]);
  if ((extExists.stdout || '').trim() === '1') {
    log('pgvector extension already enabled');
  } else {
    log('pgvector extension missing — creating');
    const createExt = runPsql([
      '-w', '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', PG_DATABASE,
      '-c', 'CREATE EXTENSION IF NOT EXISTS vector;',
    ]);
    if (createExt.status !== 0) {
      // Non-fatal: knowledge-base RAG won't work but rest of app does.
      log(`pgvector enable failed (non-fatal — RAG features disabled): ${(createExt.stderr || '').trim()}`);
      log('To enable: ensure runtime/postgres/lib/vector.dll + share/extension/vector.* present');
    } else {
      log('pgvector extension enabled');
    }
  }

  // Step 2d: final connectivity probe to the actual app database
  const finalPing = runPsql([
    '-w', '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', PG_DATABASE,
    '-Atc', 'SELECT current_database();',
  ]);
  if (finalPing.status !== 0 || (finalPing.stdout || '').trim() !== PG_DATABASE) {
    fail(`final connectivity check to ${PG_DATABASE} failed: ${(finalPing.stderr || '').trim()}`);
  }
  log(`final probe OK — app can connect to ${PG_DATABASE}`);
} finally {
  stopTempPostgres();
}

log('init-pgdata done — ready for supervisor to spawn long-running postgres');
process.exit(0);
