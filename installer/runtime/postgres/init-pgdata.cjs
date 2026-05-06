#!/usr/bin/env node
/**
 * Postgres Portable 首次启动初始化（idempotent）。
 *
 * supervisor prod 模式在 spawn postgres 之前会调本脚本：
 *   node installer/runtime/postgres/init-pgdata.cjs
 *
 * 已初始化（pgdata/PG_VERSION 存在）→ 直接 exit 0
 * 未初始化 → initdb + 启临时 postgres + createuser + createdb + CREATE EXTENSION vector
 *
 * env:
 *   TELEHUBX_INSTALL_PATH    runtime/postgres/bin 父目录
 *   TELEHUBX_DATA_DIR        pgdata 父目录
 *   PG_PORT                  端口（默认 5436）
 *   PG_USER                  应用用户（默认 telehubx）
 *   PG_PASSWORD              应用用户密码（默认 telehubx）
 *   PG_DATABASE              数据库名（默认 telehubx）
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
  : path.resolve(__dirname, '..', '..', '..');

const dataDir = path.resolve(
  expandWinVars(process.env.TELEHUBX_DATA_DIR || path.join(installPath, 'data'))
);
const pgdataDir = path.join(dataDir, 'pgdata');

const PG_PORT = process.env.PG_PORT || '5436';
const PG_USER = process.env.PG_USER || 'telehubx';
const PG_PASSWORD = process.env.PG_PASSWORD || 'telehubx';
const PG_DATABASE = process.env.PG_DATABASE || 'telehubx';

const pgBin = path.join(installPath, 'runtime', 'postgres', 'bin');
const initdbExe = path.join(pgBin, 'initdb.exe');
const pgCtlExe = path.join(pgBin, 'pg_ctl.exe');
const psqlExe = path.join(pgBin, 'psql.exe');

function log(msg) { console.log(`[init-pgdata] ${msg}`); }
function fail(msg) { console.error(`[init-pgdata] FATAL: ${msg}`); process.exit(2); }

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, { encoding: 'utf8', ...opts });
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// ── 1. 已初始化？ ──
if (exists(path.join(pgdataDir, 'PG_VERSION'))) {
  log(`pgdata already initialized at ${pgdataDir} — skipping init`);
  process.exit(0);
}

// ── 2. portable postgres 二进制存在？ ──
if (!exists(initdbExe)) fail(`initdb missing: ${initdbExe}`);
if (!exists(pgCtlExe)) fail(`pg_ctl missing: ${pgCtlExe}`);
if (!exists(psqlExe)) fail(`psql missing: ${psqlExe}`);

fs.mkdirSync(dataDir, { recursive: true });

// ── 3. initdb ──
log(`initdb -D ${pgdataDir}`);
const pwFile = path.join(os.tmpdir(), `telehubx-initpw-${process.pid}.txt`);
fs.writeFileSync(pwFile, PG_PASSWORD, 'utf8');
try {
  const r = run(initdbExe, [
    '-D', pgdataDir,
    '--username', PG_USER,
    '--pwfile', pwFile,
    '--encoding', 'UTF8',
    '--locale', 'C',
    '--auth-local', 'trust',     // 本机 trust，仅 127.0.0.1 监听
    '--auth-host', 'scram-sha-256',
  ]);
  if (!r.ok) fail(`initdb failed: ${r.stderr}`);
} finally {
  try { fs.unlinkSync(pwFile); } catch { /* ignore */ }
}

// ── 4. 写 postgresql.conf：仅监听 127.0.0.1 ──
const confPath = path.join(pgdataDir, 'postgresql.conf');
let conf = fs.readFileSync(confPath, 'utf8');
conf += `\n# TeleHubX overrides\nlisten_addresses = '127.0.0.1'\nport = ${PG_PORT}\nshared_preload_libraries = 'vector'\n`;
fs.writeFileSync(confPath, conf, 'utf8');
log(`postgresql.conf: listen=127.0.0.1 port=${PG_PORT}`);

// ── 5. 启动 postgres（临时） ──
log('starting postgres (temporary, for setup)...');
const startRes = run(pgCtlExe, [
  '-D', pgdataDir,
  '-l', path.join(dataDir, 'logs', 'postgres-init.log'),
  '-w',
  'start',
]);
if (!startRes.ok) fail(`pg_ctl start failed: ${startRes.stderr}`);

try {
  // ── 6. 创建数据库 ──
  log(`creating database "${PG_DATABASE}"...`);
  const createDb = run(psqlExe, [
    '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', 'postgres',
    '-c', `CREATE DATABASE ${PG_DATABASE} OWNER ${PG_USER};`,
  ]);
  if (!createDb.ok) {
    // 可能已存在 — 不致命
    log(`createdb non-fatal: ${createDb.stderr.trim()}`);
  }

  // ── 7. 启用 pgvector ──
  log('enabling pgvector extension...');
  const ext = run(psqlExe, [
    '-h', '127.0.0.1', '-p', PG_PORT, '-U', PG_USER, '-d', PG_DATABASE,
    '-c', 'CREATE EXTENSION IF NOT EXISTS vector;',
  ]);
  if (!ext.ok) {
    log(`pgvector non-fatal: ${ext.stderr.trim()}`);
    log('如果使用知识库 RAG, 请确保 vector.dll 已放入 runtime/postgres/lib/');
  } else {
    log('pgvector enabled');
  }
} finally {
  // ── 8. 停掉临时 postgres ── (supervisor 会重新拉一份长跑的)
  log('stopping temporary postgres...');
  run(pgCtlExe, ['-D', pgdataDir, '-m', 'fast', 'stop']);
}

log('init-pgdata done');
process.exit(0);
