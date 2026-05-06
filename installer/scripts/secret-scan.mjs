#!/usr/bin/env node
/**
 * Secret 扫描 gate — 安装包打包流水线必须调用本脚本，
 * 检测到任一禁忌字符串即非零退出。
 *
 * 用法:
 *   node installer/scripts/secret-scan.mjs <dist-dir>
 *
 * 扫描范围:
 *   - dist 目录下所有 .env / .env.* / *.json / *.js / *.ts / *.txt
 *   - 不递归到 node_modules （太大且无 secret）
 *
 * 退出码:
 *   0 = 干净
 *   1 = 发现 secret
 *   2 = 用法错误
 */
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const FORBIDDEN_VAR_NAMES = [
  'ADMIN_TOKEN',
  'LICENSE_ADMIN_TOKEN',
  'LICENSE_PEPPER',
  'LICENSE_SIGNING_SECRET',
  'AGENT_TOKEN_SECRET',
  'AGENT_TOKEN',
  'USER_PASSWORD_PEPPER',
  'JWT_SECRET',
  'SESSION_ENCRYPTION_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CF_API_TOKEN',
];

// 检测 .env 风格赋值: KEY=value (左侧匹配名字，右侧非空)
const FORBIDDEN_ASSIGN_RE = new RegExp(
  `^\\s*(${FORBIDDEN_VAR_NAMES.join('|')})\\s*=\\s*\\S`,
  'm',
);

// PEM 私钥头
const PEM_PRIVATE_RE = /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/;

const SCAN_EXTS = new Set(['.env', '.json', '.js', '.mjs', '.cjs', '.ts', '.txt', '']);

function shouldScan(file) {
  const base = file.split(/[\\/]/).pop() ?? '';
  if (base.startsWith('.env')) return true;
  return SCAN_EXTS.has(extname(file));
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile() && shouldScan(full)) yield full;
  }
}

function scan(distDir) {
  const findings = [];
  for (const file of walk(distDir)) {
    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    const m = FORBIDDEN_ASSIGN_RE.exec(content);
    if (m) {
      findings.push({ file, kind: 'forbidden_var', match: m[0].slice(0, 80) });
    }
    if (PEM_PRIVATE_RE.test(content)) {
      findings.push({ file, kind: 'private_key', match: 'PEM private key block' });
    }
  }
  return findings;
}

function main() {
  const distDir = process.argv[2];
  if (!distDir) {
    console.error('Usage: secret-scan.mjs <dist-dir>');
    process.exit(2);
  }
  console.log(`[secret-scan] scanning ${distDir} ...`);
  const findings = scan(distDir);
  if (findings.length === 0) {
    console.log('[secret-scan] OK — no forbidden secrets in dist');
    process.exit(0);
  }
  console.error(`[secret-scan] FAIL — ${findings.length} finding(s):`);
  for (const f of findings) {
    console.error(`  - ${f.kind}  ${f.file}\n      ${f.match}`);
  }
  process.exit(1);
}

main();
