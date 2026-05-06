#!/usr/bin/env node
/**
 * TeleHubX Phase 3 dist 装配脚本
 *
 *   node installer/build-dist.cjs
 *
 * 输入:
 *   apps/{server,agent,dashboard}            ← pnpm build 产物
 *   installer/tools                           ← supervisor / stop
 *   installer/runtime/                        ← Phase 3 静态资源 (init scripts)
 *   vendor/{node,postgres,memurai}            ← 二进制 (本机准备, 不入仓)
 *
 * 输出:
 *   installer/dist/                           ← 可解压即跑的独立目录
 *
 * 步骤:
 *   1. clean dist
 *   2. build server / agent / dashboard / tools (pnpm 并行)
 *   3. assemble dist/app/{server,agent,dashboard}
 *   4. assemble dist/tools (from installer/tools/dist)
 *   5. copy dist/runtime/{init scripts} (binaries 由 vendor/ 复制, 缺则警告)
 *   6. copy installer/.env.template → dist/.env
 *   7. secret-scan dist (CI gate)
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const DIST = path.join(__dirname, 'dist');
const VENDOR = path.join(REPO, 'vendor');

// ── helpers ──────────────────────────────────────────────────────────────────
function log(msg)  { console.log(`[build-dist] ${msg}`); }
function warn(msg) { console.warn(`[build-dist] WARN: ${msg}`); }
function die(msg)  { console.error(`[build-dist] FATAL: ${msg}`); process.exit(1); }

function step(name, fn) {
  const t0 = Date.now();
  log(`>> ${name}`);
  fn();
  log(`   done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function run(cmd, args, opts = {}) {
  // shell:true breaks paths with spaces on Windows. Only use shell for .cmd / .bat
  // (which is what we need for pnpm). For absolute exe paths (process.execPath),
  // use shell:false to preserve quoting.
  const needsShell = process.platform === 'win32' && !path.isAbsolute(cmd);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: needsShell, ...opts });
  if (r.status !== 0) die(`command failed: ${cmd} ${args.join(' ')}`);
}

function rmDir(d) {
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

function cpDir(src, dst, opts = {}) {
  if (!fs.existsSync(src)) {
    if (opts.optional) { warn(`source missing (skip): ${src}`); return false; }
    die(`source missing: ${src}`);
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name);
    const d = path.join(dst, f.name);
    if (f.isDirectory()) cpDir(s, d);
    else fs.copyFileSync(s, d);
  }
  return true;
}

function cpFile(src, dst, opts = {}) {
  if (!fs.existsSync(src)) {
    if (opts.optional) { warn(`file missing (skip): ${src}`); return false; }
    die(`file missing: ${src}`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

// ── 1. clean ─────────────────────────────────────────────────────────────────
step('Clean dist', () => rmDir(DIST));
fs.mkdirSync(DIST, { recursive: true });

// ── 2. build packages ────────────────────────────────────────────────────────
step('Build @telehubx/server', () =>
  run('pnpm', ['--filter', '@telehubx/server', 'build'], { cwd: REPO }));
step('Build @telehubx/agent', () =>
  run('pnpm', ['--filter', '@telehubx/agent', 'build'], { cwd: REPO }));
step('Build @telehubx/dashboard', () =>
  run('pnpm', ['--filter', '@telehubx/dashboard', 'build'], { cwd: REPO }));
step('Build @telehubx/installer-tools', () =>
  run('pnpm', ['--filter', '@telehubx/installer-tools', 'build'], { cwd: REPO }));

// ── 3-4. assemble app + tools ────────────────────────────────────────────────
// Use `pnpm deploy --prod` to produce flattened deploy artifacts (no pnpm symlinks).
// pnpm 把 .pnpm 目录里的真实文件解引用复制过来 → 客户端无 pnpm 也能跑.
step('Assemble dist/app/server (pnpm deploy --prod)', () => {
  // Use relative path; spaces in REPO root break spawn-with-shell on Windows
  const relTarget = path.relative(REPO, path.join(DIST, 'app/server')).replace(/\\/g, '/');
  rmDir(path.join(DIST, 'app/server'));
  run('pnpm', ['--filter', '@telehubx/server', 'deploy', '--prod', relTarget], { cwd: REPO });
});

step('Assemble dist/app/agent (pnpm deploy --prod)', () => {
  const relTarget = path.relative(REPO, path.join(DIST, 'app/agent')).replace(/\\/g, '/');
  rmDir(path.join(DIST, 'app/agent'));
  run('pnpm', ['--filter', '@telehubx/agent', 'deploy', '--prod', relTarget], { cwd: REPO });
});

step('Assemble dist/app/dashboard', () => {
  cpDir(path.join(REPO, 'apps/dashboard/dist'), path.join(DIST, 'app/dashboard/dist'));
  cpFile(path.join(REPO, 'apps/dashboard/serve.cjs'), path.join(DIST, 'app/dashboard/serve.cjs'));
  cpFile(path.join(REPO, 'apps/dashboard/package.json'), path.join(DIST, 'app/dashboard/package.json'));
});

step('Assemble dist/tools', () => {
  cpDir(path.join(REPO, 'installer/tools/dist'), path.join(DIST, 'tools'));
});

// ── 5. runtime ───────────────────────────────────────────────────────────────
step('Copy runtime init scripts', () => {
  // postgres init script (always present in repo)
  cpFile(
    path.join(REPO, 'installer/runtime/postgres/init-pgdata.cjs'),
    path.join(DIST, 'runtime/postgres/init-pgdata.cjs'),
  );
});

step('Copy runtime binaries (from vendor/)', () => {
  // Optional — present only on build host. Missing = dev/CI mode.
  const okNode = cpDir(path.join(VENDOR, 'node-v20-win-x64'), path.join(DIST, 'runtime/node'), { optional: true });
  const okPg = cpDir(path.join(VENDOR, 'postgres-16-portable'), path.join(DIST, 'runtime/postgres'), { optional: true });
  const okMm = cpDir(path.join(VENDOR, 'memurai'), path.join(DIST, 'runtime/memurai'), { optional: true });
  if (!okNode || !okPg || !okMm) {
    warn('runtime binaries not all present — dist will only run with TELEHUBX_RUNTIME_MODE=dev (external services)');
    warn('see installer/runtime/README.md for binary acquisition');
  }
});

// ── 6. .env ──────────────────────────────────────────────────────────────────
step('Copy .env.template', () => {
  cpFile(path.join(REPO, 'installer/.env.template'), path.join(DIST, '.env'));
});

// ── 7. README in dist ────────────────────────────────────────────────────────
step('Write dist/README.md', () => {
  const md = `# TeleHubX dist (Phase 3 standalone bundle)

Layout:
  app/{server,agent,dashboard}     — built code + node_modules
  tools/                           — supervisor.js / stop.js + shared/
  runtime/{node,postgres,memurai}  — portable binaries (may be missing in dev bundle)
  .env                             — runtime config (no secrets)

Run:
  set TELEHUBX_INSTALL_PATH=%CD%
  set TELEHUBX_DATA_DIR=%APPDATA%\\TeleHubX\\data
  set TELEHUBX_RUNTIME_MODE=prod   (or dev to use external Docker pg/redis)
  node tools/supervisor.js

Stop:
  node tools/stop.js
`;
  fs.writeFileSync(path.join(DIST, 'README.md'), md, 'utf8');
});

// ── 8. secret scan gate ──────────────────────────────────────────────────────
step('Secret scan dist', () => {
  run(process.execPath, [path.join(REPO, 'installer/scripts/secret-scan.mjs'), DIST]);
});

log(`\n✓ dist assembled at: ${DIST}`);
log(`\nNext: cd ${DIST} && node tools/supervisor.js`);
