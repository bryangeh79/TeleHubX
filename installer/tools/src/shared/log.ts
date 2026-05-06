import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

/**
 * 日志输出 + 敏感字段脱敏。
 *
 * 永远不打印：licenseKey 明文、agentToken、password、TG_SESSION 整串、
 * JWT_SECRET、SESSION_ENCRYPTION_KEY、ADMIN_TOKEN 等。
 */

const REDACT_PATTERNS: Array<{ re: RegExp; replace: (m: string, ...rest: string[]) => string }> = [
  // KV 风格: licenseKey="..." / agentToken: '...' / password=...
  {
    re: /("?(licenseKey|agentToken|password|TG_SESSION|JWT_SECRET|SESSION_ENCRYPTION_KEY|ADMIN_TOKEN|LICENSE_ADMIN_TOKEN|LICENSE_PEPPER|AGENT_TOKEN_SECRET|USER_PASSWORD_PEPPER|CLOUDFLARE_API_TOKEN|CF_API_TOKEN)"?\s*[:=]\s*)"?[^"\s,}]+"?/gi,
    replace: (_m, prefix) => `${prefix}"[REDACTED]"`,
  },
  // license key 字面值: THX-XXXX-... / TLHX-...
  { re: /\b(THX|TLHX)-[A-Z0-9-]{8,}/gi, replace: () => 'THX-[REDACTED]' },
  // base64 长串（>=40 chars 连续）— 谨慎匹配，避免误伤
  // 已注释，因为容易误伤；仅在确认安全后启用
];

let logFile: string | null = null;

export function setLogFile(file: string): void {
  logFile = file;
  try { mkdirSync(path.dirname(file), { recursive: true }); } catch { /* ignore */ }
}

function redact(msg: string): string {
  let out = msg;
  for (const { re, replace } of REDACT_PATTERNS) out = out.replace(re, replace);
  return out;
}

function ts(): string { return new Date().toISOString(); }

function write(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  const line = `${ts()} [${level}] ${redact(msg)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (logFile) {
    try { appendFileSync(logFile, line + '\n', 'utf8'); } catch { /* ignore */ }
  }
}

export const log = {
  info: (m: string) => write('INFO', m),
  warn: (m: string) => write('WARN', m),
  error: (m: string) => write('ERROR', m),
};
