#!/usr/bin/env node
/**
 * TeleHubX dist assembler (Issue #12 redesign).
 *
 *   node installer/build-dist.cjs
 *
 * Inputs:
 *   apps/{server,agent,dashboard}            built dists
 *   installer/tools                          supervisor / stop sources + dist
 *   installer/runtime/                       static runtime helper scripts
 *   vendor/{node,postgres,memurai}           binaries (build-host only, gitignored)
 *
 * Output:
 *   installer/dist/                          standalone bundle
 *
 * Steps:
 *   0. Snapshot canary files (verify untouched after every step)
 *   1. Clean dist
 *   2. pnpm build server / agent / dashboard / tools
 *   3. Assemble dist/app/{server,agent} via:
 *        - copy dist/ + package.json
 *        - stagingDepsInstall: npm install --omit=dev in %TEMP%/telehubx-staging-*
 *          (FLAT node_modules, no .pnpm/<long-hash>/, no source destruction)
 *        - move staging node_modules into dist
 *   4. Assemble dist/app/dashboard (static; no node_modules)
 *   5. Copy installer/tools/dist to dist/tools
 *   6. Copy runtime init scripts + vendor binaries
 *   7. Copy .env.template
 *   8. Path length scan (fail-fast > 240 chars)
 *   9. secret-scan dist (fail-fast on forbidden vars / private keys)
 *
 * Issue #12 fix:
 *   - DOES NOT call `pnpm deploy`. Three documented destructions of workspace
 *     source. npm install in a clean staging dir is safe.
 *   - npm produces flat node_modules, sidestepping ISCC + Windows MAX_PATH (260)
 *     issue with pnpm `.pnpm/<package@version>_<peer-hash>/` chains.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const crypto = require('node:crypto');

const REPO   = path.resolve(__dirname, '..');
const DIST   = path.join(__dirname, 'dist');
const VENDOR = path.join(REPO, 'vendor');

// ── helpers ─────────────────────────────────────────────────────────────────
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
  // (pnpm/npm). For absolute exe paths use shell:false to preserve quoting.
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

// ── canary: detect any source destruction ──────────────────────────────────
const CANARY_FILES = [
  'apps/server/tsconfig.json',
  'apps/server/nest-cli.json',
  'apps/server/package.json',
  'apps/server/src/main.ts',
  'apps/server/src/app.module.ts',
  'apps/agent/tsconfig.json',
  'apps/agent/package.json',
  'apps/agent/src/main.ts',
  'apps/dashboard/package.json',
];

function snapshotCanary() {
  const snap = {};
  for (const rel of CANARY_FILES) {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) {
      die(`canary file missing BEFORE build (workspace already broken): ${rel}`);
    }
    const buf = fs.readFileSync(p);
    snap[rel] = { size: buf.length, sha: crypto.createHash('sha1').update(buf).digest('hex') };
  }
  return snap;
}

function verifyCanary(snap, label) {
  for (const rel of CANARY_FILES) {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) {
      die(`CANARY FAIL after [${label}]: source file deleted: ${rel}`);
    }
    const buf = fs.readFileSync(p);
    if (buf.length !== snap[rel].size) {
      die(`CANARY FAIL after [${label}]: size changed for ${rel} (was ${snap[rel].size}, now ${buf.length})`);
    }
    const sha = crypto.createHash('sha1').update(buf).digest('hex');
    if (sha !== snap[rel].sha) {
      die(`CANARY FAIL after [${label}]: content changed for ${rel}`);
    }
  }
}

// ── staging-based prod deps install (replaces pnpm deploy) ─────────────────
// Strategy: copy ONLY package.json to a fresh %TEMP% dir. Run npm install
// --omit=dev --no-package-lock --no-audit --no-fund in that dir. Move the
// resulting flat node_modules into installer/dist/app/<pkg>/node_modules.
// Workspace source is never touched (npm doesn't know about pnpm symlinks).

function stagingDepsInstall(appName, finalAppDir) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), `telehubx-staging-${appName}-`));
  log(`   staging at ${stagingRoot}`);
  try {
    // 1. Copy package.json into staging (NO pnpm-lock, NO source)
    const srcPkgJson = path.join(REPO, 'apps', appName, 'package.json');
    cpFile(srcPkgJson, path.join(stagingRoot, 'package.json'));

    // 2. npm install --omit=dev (flat node_modules, no .pnpm symlinks)
    log(`   npm install --omit=dev (this may take a while)`);
    run('npm', [
      'install',
      '--omit=dev',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',  // skip postinstall (avoids surprises like pdf-parse downloads)
      '--silent',
    ], { cwd: stagingRoot });

    // 3. Move node_modules to final dest
    const stagingNm = path.join(stagingRoot, 'node_modules');
    const finalNm   = path.join(finalAppDir, 'node_modules');
    if (!fs.existsSync(stagingNm)) {
      die(`npm install produced no node_modules in ${stagingNm}`);
    }
    rmDir(finalNm);
    // rename across drives may fail on Windows -> fall back to copy+remove
    try {
      fs.renameSync(stagingNm, finalNm);
    } catch {
      cpDir(stagingNm, finalNm);
      rmDir(stagingNm);
    }
    log(`   node_modules installed at ${path.relative(REPO, finalNm)}`);
  } finally {
    rmDir(stagingRoot);
  }
}

function assembleAppPackage(appName) {
  const srcDir = path.join(REPO, 'apps', appName);
  const dstDir = path.join(DIST, 'apps', appName);
  rmDir(dstDir);
  fs.mkdirSync(dstDir, { recursive: true });
  // Built code only (we DO NOT touch source dirs)
  cpDir(path.join(srcDir, 'dist'), path.join(dstDir, 'dist'));
  cpFile(path.join(srcDir, 'package.json'), path.join(dstDir, 'package.json'));
  // Production node_modules via staging (out-of-tree npm install)
  stagingDepsInstall(appName, dstDir);
}

// ── path length scanner (fail-fast > 240 chars) ────────────────────────────
const MAX_PATH_LIMIT = 240;     // leave headroom under Windows 260

function scanPathLengths(root) {
  let longest = '';
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (p.length > longest.length) longest = p;
      if (e.isDirectory()) stack.push(p);
    }
  }
  return longest;
}

// ── pipeline ───────────────────────────────────────────────────────────────
const canary = snapshotCanary();
log(`canary baseline: ${CANARY_FILES.length} files snapshotted`);

step('Clean dist', () => rmDir(DIST));
fs.mkdirSync(DIST, { recursive: true });
verifyCanary(canary, 'Clean dist');

step('Build @telehubx/server', () =>
  run('pnpm', ['--filter', '@telehubx/server', 'build'], { cwd: REPO }));
verifyCanary(canary, 'Build server');

step('Build @telehubx/agent', () =>
  run('pnpm', ['--filter', '@telehubx/agent', 'build'], { cwd: REPO }));
verifyCanary(canary, 'Build agent');

step('Build @telehubx/dashboard', () =>
  run('pnpm', ['--filter', '@telehubx/dashboard', 'build'], { cwd: REPO }));
verifyCanary(canary, 'Build dashboard');

step('Build @telehubx/installer-tools', () =>
  run('pnpm', ['--filter', '@telehubx/installer-tools', 'build'], { cwd: REPO }));
verifyCanary(canary, 'Build tools');

step('Assemble dist/app/server (staged npm install)', () => assembleAppPackage('server'));
verifyCanary(canary, 'Assemble server');

step('Assemble dist/app/agent (staged npm install)', () => assembleAppPackage('agent'));
verifyCanary(canary, 'Assemble agent');

step('Assemble dist/app/dashboard', () => {
  const dst = path.join(DIST, 'apps/dashboard');
  rmDir(dst);
  cpDir(path.join(REPO, 'apps/dashboard/dist'), path.join(dst, 'dist'));
  cpFile(path.join(REPO, 'apps/dashboard/serve.cjs'), path.join(dst, 'serve.cjs'));
  cpFile(path.join(REPO, 'apps/dashboard/package.json'), path.join(dst, 'package.json'));
});
verifyCanary(canary, 'Assemble dashboard');

step('Assemble dist/tools', () => {
  cpDir(path.join(REPO, 'installer/tools/dist'), path.join(DIST, 'tools'));
});

step('Copy runtime init scripts', () => {
  cpFile(
    path.join(REPO, 'installer/runtime/postgres/init-pgdata.cjs'),
    path.join(DIST, 'runtime/postgres/init-pgdata.cjs'),
  );
  // vmfix8 / Issue #19: silent VBS launchers + Debug shortcut in dist/tools/
  cpFile(
    path.join(REPO, 'installer/runtime/launcher/telehubx-start.vbs'),
    path.join(DIST, 'tools/telehubx-start.vbs'),
  );
  cpFile(
    path.join(REPO, 'installer/runtime/launcher/telehubx-stop.vbs'),
    path.join(DIST, 'tools/telehubx-stop.vbs'),
  );
  cpFile(
    path.join(REPO, 'installer/runtime/launcher/telehubx-debug.vbs'),
    path.join(DIST, 'tools/telehubx-debug.vbs'),
  );
  // vmfix22 / Issue #25: HTA loading splash spawned by telehubx-start.vbs
  // so the operator gets visible feedback during the 2-3 min cold-first
  // -install window (postgres initdb + Nest boot).
  cpFile(
    path.join(REPO, 'installer/runtime/launcher/telehubx-loading.hta'),
    path.join(DIST, 'tools/telehubx-loading.hta'),
  );
  // vmfix22 (Issue #28): TeleHubX Dashboard shortcut — pure browser-open,
  // no service interaction. Daily entry point post Auto-start.
  cpFile(
    path.join(REPO, 'installer/runtime/launcher/telehubx-open.vbs'),
    path.join(DIST, 'tools/telehubx-open.vbs'),
  );
  // Issue #19: WinSW Windows Service wrapper + service descriptor.
  // WinSW.exe is renamed to telehubx-service.exe so its sibling XML
  // (telehubx-service.xml) is auto-discovered.
  cpFile(
    path.join(REPO, 'vendor/winsw/winsw.exe'),
    path.join(DIST, 'tools/telehubx-service.exe'),
  );
  cpFile(
    path.join(REPO, 'installer/runtime/winsw/telehubx-service.xml'),
    path.join(DIST, 'tools/telehubx-service.xml'),
  );
  // Bundled redis.conf + license stub (always shipped, even if vendor/redis-windows missing)
  cpFile(
    path.join(REPO, 'installer/runtime/redis/redis.conf'),
    path.join(DIST, 'runtime/redis/redis.conf'),
  );
  cpFile(
    path.join(REPO, 'installer/runtime/redis/LICENSE-tporadowski-redis.txt'),
    path.join(DIST, 'runtime/redis/LICENSE-tporadowski-redis.txt'),
  );
});

step('Copy runtime binaries (from vendor/)', () => {
  const okNode = cpDir(path.join(VENDOR, 'node-v20-win-x64'),     path.join(DIST, 'runtime/node'),     { optional: true });
  const okPg   = cpDir(path.join(VENDOR, 'postgres-16-portable'), path.join(DIST, 'runtime/postgres'), { optional: true });
  const okRedis = cpDir(path.join(VENDOR, 'redis-windows'),       path.join(DIST, 'runtime/redis'),    { optional: true });
  // Bundle the redis.conf from installer/runtime/redis/ into dist/runtime/redis/
  const cfgSrc = path.join(REPO, 'installer/runtime/redis/redis.conf');
  if (fs.existsSync(cfgSrc) && okRedis) {
    cpFile(cfgSrc, path.join(DIST, 'runtime/redis/redis.conf'));
  }
  if (!okNode || !okPg || !okRedis) {
    warn('runtime binaries not all present -- dist will only run with TELEHUBX_RUNTIME_MODE=dev');
    warn('see installer/runtime/README.md for binary acquisition');
  }
});

step('Copy .env.template', () => {
  cpFile(path.join(REPO, 'installer/.env.template'), path.join(DIST, '.env'));
});

// vmfix14 (Issue #21): write VERSION.txt so Bryan can verify in 1 command
// which build is actually installed on the VM. Stale binaries / R2 cache /
// half-applied installs are a recurring source of "I changed it but it's not
// in the artifact" confusion.
step('Write VERSION.txt', () => {
  const { execSync } = require('node:child_process');
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: REPO, encoding: 'utf8' }).trim(); }
  catch { /* ignore */ }
  const buildTime = new Date().toISOString();
  const content =
    `version=vmfix22\n` +
    `commit=${commit}\n` +
    `buildTime=${buildTime}\n` +
    `artifact=TeleHubX-Setup-1.0.0-vmfix22.exe\n` +
    `serviceIdentity=NT AUTHORITY\\LocalService\n`;
  fs.writeFileSync(path.join(DIST, 'VERSION.txt'), content, 'utf8');
  log(`   ${content.replace(/\n/g, ' | ').trim()}`);
});

step('Write dist/README.md', () => {
  const md = `# TeleHubX dist (standalone bundle)\n\n` +
    `Layout:\n` +
    `  app/{server,agent,dashboard}     built code + node_modules (npm flat)\n` +
    `  tools/                           supervisor.js / stop.js (and SEA exes after build.ps1)\n` +
    `  runtime/{node,postgres,memurai}  portable binaries\n` +
    `  .env                             runtime config (no secrets)\n\n` +
    `Run:\n` +
    `  set TELEHUBX_INSTALL_PATH=%CD%\n` +
    `  set TELEHUBX_DATA_DIR=%APPDATA%\\TeleHubX\\data\n` +
    `  set TELEHUBX_RUNTIME_MODE=prod\n` +
    `  node tools/supervisor.js\n\n` +
    `Stop:\n` +
    `  node tools/stop.js\n`;
  fs.writeFileSync(path.join(DIST, 'README.md'), md, 'utf8');
});

// ── 8. path length scan ────────────────────────────────────────────────────
step(`Path length scan (limit ${MAX_PATH_LIMIT})`, () => {
  const longest = scanPathLengths(DIST);
  log(`   longest path: ${longest.length} chars`);
  log(`   ${longest}`);
  if (longest.length > MAX_PATH_LIMIT) {
    die(
      `path length ${longest.length} exceeds limit ${MAX_PATH_LIMIT} -- ISCC will fail.\n` +
      `        offending path: ${longest}\n` +
      `        action: investigate why npm install produced a deep tree, ` +
      `or trim with installer/build-dist.cjs PRUNE rules.`,
    );
  }
});

// ── 9. secret scan ─────────────────────────────────────────────────────────
step('Secret scan dist', () => {
  run(process.execPath, [path.join(REPO, 'installer/scripts/secret-scan.mjs'), DIST]);
});

verifyCanary(canary, 'final');
log(`\n  OK  dist assembled at: ${DIST}`);
log(`\n  Next: cd ${DIST} && node tools/supervisor.js`);
