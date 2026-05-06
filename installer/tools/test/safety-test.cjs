#!/usr/bin/env node
/**
 * TeleHubX stop 工具 — 自动化安全测试
 *
 * 关键不变量：
 *   *绝对不能误杀任何非 TeleHubX 进程*
 *
 * 本测试通过真实 spawn 一个长跑 node 进程模拟 "其他用户的 node 程序"，
 * 写入指向该进程的 fake pid 文件，运行真实 stop（非 dry-run），
 * 然后断言：spawned 进程仍存活。任何场景里它若被杀，测试失败 → exit 1。
 *
 * 使用：
 *   node installer/tools/test/safety-test.cjs
 *   pnpm --filter @telehubx/installer-tools test:safety
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// ── env -----------------------------------------------------------------------
const APPDATA = process.env.APPDATA;
if (!APPDATA) {
  console.error('FATAL: APPDATA not set — this test runs Windows only');
  process.exit(2);
}
const RUN_DIR = path.join(APPDATA, 'TeleHubX', 'data', 'run');
const STOP_JS = path.resolve(__dirname, '..', 'dist', 'stop.js');

if (!fs.existsSync(STOP_JS)) {
  console.error(`FATAL: stop.js not built. Run: pnpm --filter @telehubx/installer-tools build`);
  console.error(`Expected: ${STOP_JS}`);
  process.exit(2);
}

// ── helpers -------------------------------------------------------------------
const failures = [];
function ok(msg)   { console.log(`  ✓ ${msg}`); }
function fail(msg, why) {
  console.error(`  ✗ ${msg}\n      ${why}`);
  failures.push(`${msg}: ${why}`);
}
function info(msg) { console.log(`  • ${msg}`); }

function spawnSleeperNode(durationSec) {
  // Long-running node process, NOT in any TeleHubX install path
  const child = spawn(
    process.execPath,
    ['-e', `setTimeout(()=>{ process.exit(0); }, ${durationSec * 1000});`],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  if (!child.pid) throw new Error('failed to spawn sleeper');
  return child.pid;
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

function getProcessCreationDate(pid) {
  // Same query stop.ts uses
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
    `if ($p -and $p.CreationDate) { [int64]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }`,
  ], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const t = (r.stdout || '').trim();
  return t ? Number(t) : null;
}

function writePidFile(service, rec) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, `${service}.pid`), JSON.stringify(rec, null, 2));
}

function cleanRunDir() {
  if (!fs.existsSync(RUN_DIR)) return;
  for (const f of fs.readdirSync(RUN_DIR)) {
    if (f.endsWith('.pid')) {
      try { fs.unlinkSync(path.join(RUN_DIR, f)); } catch { /* ignore */ }
    }
  }
}

function runRealStop() {
  // NEVER pass dry-run here — we must verify the real path doesn't kill
  return spawnSync(process.execPath, [STOP_JS], {
    encoding: 'utf8',
    env: { ...process.env, TELEHUBX_STOP_DRY_RUN: '0' },
  });
}

// ── scenarios -----------------------------------------------------------------

async function scenarioExeOutsideInstall() {
  console.log('\n[1] exe_outside_install — fake pid claims our install path, real exe is system node');
  cleanRunDir();
  const sleeperPid = spawnSleeperNode(30);
  await waitMs(300); // let OS register
  info(`spawned sleeper pid=${sleeperPid} (system node, NOT TeleHubX)`);

  const ts = getProcessCreationDate(sleeperPid) || Date.now();
  writePidFile('server', {
    service: 'server',
    pid: sleeperPid,
    exe: 'C:\\Program Files\\TeleHubX\\runtime\\node\\node.exe',          // FAKE exe
    args: ['C:\\Program Files\\TeleHubX\\app\\server\\dist\\main.js'],
    installPath: 'C:\\Program Files\\TeleHubX',                            // FAKE install path
    startedAt: ts,
  });

  const r = runRealStop();
  await waitMs(500);

  if (isPidAlive(sleeperPid)) ok('non-TeleHubX node still alive after stop');
  else fail('non-TeleHubX node KILLED', `pid=${sleeperPid} should not have been touched`);

  if ((r.stdout || '').includes('SKIP server')) ok('stop logged SKIP for fake pid');
  else fail('stop did not log SKIP server', `stdout head: ${(r.stdout || '').slice(0, 300)}`);

  if (!(r.stdout || '').includes('killed pid=' + sleeperPid)) ok('stop did NOT log kill for sleeper');
  else fail('stop reported killing the sleeper', 'CRITICAL: false-positive kill');

  try { process.kill(sleeperPid); } catch { /* ignore */ }
  cleanRunDir();
}

async function scenarioPidReuse() {
  console.log('\n[2] creation_drift — startedAt differs from process CreationDate by >5s');
  cleanRunDir();
  const sleeperPid = spawnSleeperNode(30);
  await waitMs(300);
  info(`spawned sleeper pid=${sleeperPid}`);

  // Even if exe path matches (process.execPath), drift will fail step 6
  writePidFile('server', {
    service: 'server',
    pid: sleeperPid,
    exe: process.execPath,                 // matches real exe
    args: [process.execPath, '-e'],         // matches real cmdline
    installPath: path.dirname(process.execPath),
    startedAt: Date.now() - 60_000,         // 60 seconds ago — drift will fail
  });

  const r = runRealStop();
  await waitMs(500);

  if (isPidAlive(sleeperPid)) ok('sleeper survives despite cmdline+exe match (drift saved it)');
  else fail('sleeper killed', 'creation drift check failed to protect');

  if ((r.stdout || '').includes('creation_drift')) ok('stop reported creation_drift reason');
  else fail('stop did not mention creation_drift', `stdout: ${(r.stdout || '').slice(0, 300)}`);

  try { process.kill(sleeperPid); } catch { /* ignore */ }
  cleanRunDir();
}

async function scenarioCmdlineMismatch() {
  console.log('\n[3] cmdline_mismatch — exe matches but args don\'t');
  cleanRunDir();
  const sleeperPid = spawnSleeperNode(30);
  await waitMs(300);
  info(`spawned sleeper pid=${sleeperPid}`);

  const ts = getProcessCreationDate(sleeperPid) || Date.now();
  writePidFile('server', {
    service: 'server',
    pid: sleeperPid,
    exe: process.execPath,
    args: ['C:\\Program Files\\TeleHubX\\app\\server\\dist\\main.js'],     // sleeper has '-e ...', not this
    installPath: path.dirname(process.execPath),
    startedAt: ts,
  });

  const r = runRealStop();
  await waitMs(500);

  if (isPidAlive(sleeperPid)) ok('sleeper survives cmdline mismatch');
  else fail('sleeper killed', 'cmdline check failed to protect');

  if ((r.stdout || '').includes('cmdline_mismatch')) ok('stop reported cmdline_mismatch');
  else fail('stop did not mention cmdline_mismatch', `stdout: ${(r.stdout || '').slice(0, 300)}`);

  try { process.kill(sleeperPid); } catch { /* ignore */ }
  cleanRunDir();
}

async function scenarioServiceNotWhitelisted() {
  console.log('\n[4] service_not_whitelisted — pid file claims unknown service');
  cleanRunDir();
  const sleeperPid = spawnSleeperNode(30);
  await waitMs(300);

  // Use a service name NOT in the whitelist; stop's STOP_ORDER iterates whitelist only,
  // so unknown service files are simply not picked up. Verify that.
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'evil.pid'), JSON.stringify({
    service: 'evil',
    pid: sleeperPid,
    exe: process.execPath,
    args: [process.execPath, '-e'],
    installPath: path.dirname(process.execPath),
    startedAt: Date.now(),
  }, null, 2));

  const r = runRealStop();
  await waitMs(500);

  if (isPidAlive(sleeperPid)) ok('sleeper survives — non-whitelisted service ignored');
  else fail('sleeper killed via non-whitelisted service file', 'CRITICAL');

  if ((r.stdout || '').includes('unrecognized pid file')) ok('stop logged unrecognized pid file warning');
  else fail('stop did not log unrecognized pid file', `stdout: ${(r.stdout || '').slice(0, 300)}`);

  try { process.kill(sleeperPid); } catch { /* ignore */ }
  cleanRunDir();
}

async function scenarioServiceFieldMismatch() {
  console.log('\n[5] service_field_mismatch — pid file renamed (server.pid claims service=postgres)');
  cleanRunDir();
  const sleeperPid = spawnSleeperNode(30);
  await waitMs(300);

  const ts = getProcessCreationDate(sleeperPid) || Date.now();
  // File is server.pid but inner field claims it's postgres
  writePidFile('server', {
    service: 'postgres',                // mismatch with file name
    pid: sleeperPid,
    exe: process.execPath,
    args: [process.execPath, '-e'],
    installPath: path.dirname(process.execPath),
    startedAt: ts,
  });

  const r = runRealStop();
  await waitMs(500);

  if (isPidAlive(sleeperPid)) ok('sleeper survives — service field mismatch detected');
  else fail('sleeper killed despite field mismatch', 'CRITICAL');

  if ((r.stdout || '').includes('service_field_mismatch')) ok('stop reported service_field_mismatch');
  else fail('stop did not mention service_field_mismatch', `stdout: ${(r.stdout || '').slice(0, 300)}`);

  try { process.kill(sleeperPid); } catch { /* ignore */ }
  cleanRunDir();
}

async function scenarioDeadPid() {
  console.log('\n[6] pid_not_alive — pid file points to already-exited process');
  cleanRunDir();

  // spawn + immediately exit
  const r0 = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
  // Use a definitely-dead PID (some PID well beyond reasonable + we'll find any actually-dead)
  const deadPid = 999999; // virtually guaranteed to be dead

  writePidFile('server', {
    service: 'server',
    pid: deadPid,
    exe: process.execPath,
    args: [process.execPath, '-e'],
    installPath: path.dirname(process.execPath),
    startedAt: Date.now(),
  });

  const r = runRealStop();

  if ((r.stdout || '').includes('pid_not_alive')) ok('stop reported pid_not_alive');
  else fail('stop did not mention pid_not_alive', `stdout: ${(r.stdout || '').slice(0, 300)}`);

  cleanRunDir();
}

async function main() {
  console.log('==== TeleHubX Stop Safety Test ====');
  console.log(`stop.js: ${STOP_JS}`);
  console.log(`run dir: ${RUN_DIR}`);

  cleanRunDir();
  try {
    await scenarioExeOutsideInstall();
    await scenarioPidReuse();
    await scenarioCmdlineMismatch();
    await scenarioServiceNotWhitelisted();
    await scenarioServiceFieldMismatch();
    await scenarioDeadPid();
  } finally {
    cleanRunDir();
  }

  console.log('\n==== Summary ====');
  if (failures.length === 0) {
    console.log('ALL PASSED ✓  stop is safe.');
    process.exit(0);
  } else {
    console.error(`FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('test runner crashed:', e);
  process.exit(2);
});
