/**
 * One-shot interactive Telegram login wizard.
 *
 * Reads TG_API_ID + TG_API_HASH from project-root .env, then prompts the
 * user for phone / OTP / 2FA password directly in their terminal. On
 * success, writes TG_PHONE + TG_SESSION back into .env so the agent can
 * subsequently boot with a valid session.
 *
 * Run from project root:
 *   pnpm --filter @telehubx/agent run login
 *
 * Nothing the user types is sent to chat, git, or stored in logs. The
 * StringSession that comes out of GramJS is treated like a password.
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

const ENV_PATH = path.resolve(__dirname, '../../../.env');

const DEVICE_FINGERPRINT = {
  deviceModel: 'Samsung SM-S928B',
  systemVersion: 'Android 14',
  appVersion: '10.14.2',
  langCode: 'en',
  systemLangCode: 'en',
};

interface EnvMap {
  [key: string]: string;
}

function loadEnv(): EnvMap {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`✗ .env not found at: ${ENV_PATH}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf-8');
  return dotenv.parse(raw);
}

/**
 * Update keys in the existing .env preserving order, comments, and BOM.
 * Keys not present get appended at the end under a section header.
 */
function writeEnv(updates: EnvMap): void {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  const lines = raw.split(/\r?\n/);
  const seen = new Set<string>();

  const replaced = lines.map((line) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) return line;
    const key = m[1];
    if (key in updates) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  const missing = Object.keys(updates).filter((k) => !seen.has(k));
  if (missing.length) {
    if (replaced[replaced.length - 1] !== '') replaced.push('');
    replaced.push('# --- Telegram session (added by login-wizard) ---');
    for (const k of missing) {
      replaced.push(`${k}=${updates[k]}`);
    }
  }

  fs.writeFileSync(ENV_PATH, replaced.join('\n'), 'utf-8');
}

/**
 * Mask a value for display: show first 4 + last 4 chars, hide the rest.
 * Never log the full secret.
 */
function mask(value: string): string {
  if (!value) return '<empty>';
  if (value.length <= 12) return value.slice(0, 2) + '***' + value.slice(-2);
  return value.slice(0, 4) + '...' + value.slice(-4) + ` (len=${value.length})`;
}

async function ask(rl: readline.Interface, prompt: string): Promise<string> {
  const v = await rl.question(prompt);
  return v.trim();
}

/**
 * Prompt that hides what the user types (for 2FA password).
 * readline doesn't natively support hidden input, so we mute stdout
 * during input.
 */
async function askSecret(rl: readline.Interface, prompt: string): Promise<string> {
  output.write(prompt);
  return await new Promise<string>((resolve) => {
    let value = '';
    const rawListener = (chunk: Buffer) => {
      const ch = chunk.toString('utf-8');
      if (ch === '\n' || ch === '\r' || ch === '\r\n') {
        input.removeListener('data', rawListener);
        if (input.isTTY) input.setRawMode(false);
        input.pause();
        output.write('\n');
        resolve(value);
      } else if (ch === '') {
        // Ctrl+C
        process.exit(130);
      } else if (ch === '' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    input.on('data', rawListener);
  });
}

async function main(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TeleHubX Login Wizard');
  console.log('  (interactive · runs only on this machine)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  const env = loadEnv();
  const apiIdRaw = env.TG_API_ID;
  const apiHash = env.TG_API_HASH;

  if (!apiIdRaw || !apiHash) {
    console.error('✗ TG_API_ID and/or TG_API_HASH missing in .env');
    console.error();
    console.error('  Get yours at https://my.telegram.org/apps (login → "API development tools")');
    console.error('  Then add to .env at project root:');
    console.error('    TG_API_ID=<numeric id>');
    console.error('    TG_API_HASH=<32-char hex>');
    console.error();
    console.error('  Re-run this wizard after adding them.');
    process.exit(1);
  }

  const apiId = parseInt(apiIdRaw, 10);
  if (!Number.isFinite(apiId) || apiId <= 0) {
    console.error(`✗ TG_API_ID is not a positive integer: ${apiIdRaw}`);
    process.exit(1);
  }

  console.log(`  api_id   : ${apiId}`);
  console.log(`  api_hash : ${mask(apiHash)}`);
  console.log();

  const rl = readline.createInterface({ input, output });

  // --- phone ---
  const defaultPhone = env.TG_PHONE ?? '';
  const phonePrompt = defaultPhone
    ? `Phone number [+E.164, default ${defaultPhone}]: `
    : `Phone number [+E.164, e.g. +60123456789]: `;
  let phone = await ask(rl, phonePrompt);
  if (!phone && defaultPhone) phone = defaultPhone;
  if (!/^\+\d{6,15}$/.test(phone)) {
    console.error(`✗ phone must be in international E.164 format (got: ${phone})`);
    rl.close();
    process.exit(1);
  }

  // proxy is optional — agent's .env may have TG_PROXY_*
  const proxy =
    env.TG_PROXY_IP
      ? {
          ip: env.TG_PROXY_IP,
          port: parseInt(env.TG_PROXY_PORT ?? '1080', 10),
          socksType: 5 as const,
          username: env.TG_PROXY_USER,
          password: env.TG_PROXY_PASS,
        }
      : undefined;
  if (proxy) {
    console.log(`  proxy   : socks5 ${proxy.ip}:${proxy.port} (username=${proxy.username ?? '-'})`);
  } else {
    console.log(`  proxy   : (none — direct connection)`);
  }
  console.log();

  // --- start client.start ---
  console.log('Connecting to Telegram…');
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
    proxy,
    ...DEVICE_FINGERPRINT,
  });

  try {
    await client.start({
      phoneNumber: async () => phone,
      phoneCode: async () => {
        console.log();
        return await ask(rl, 'OTP code (check Telegram app or SMS): ');
      },
      password: async (hint?: string) => {
        console.log();
        if (hint) console.log(`  2FA hint: ${hint}`);
        return await askSecret(rl, '2FA password (hidden): ');
      },
      onError: async (err: Error) => {
        console.error('✗ login error:', err.message);
        return false; // do not retry
      },
    });
  } catch (err) {
    console.error();
    console.error('✗ login failed:', err instanceof Error ? err.message : String(err));
    rl.close();
    process.exit(1);
  }

  // --- success ---
  const me = (await client.getMe()) as { username?: string; firstName?: string; phone?: string };
  const session = (client.session as StringSession).save();

  await client.disconnect();
  rl.close();

  console.log();
  console.log('✓ Logged in successfully');
  console.log(`  identity : @${me.username ?? '(no username)'}  ${me.firstName ?? ''}  +${me.phone ?? ''}`);
  console.log(`  session  : ${mask(session)}`);
  console.log();

  // --- persist ---
  writeEnv({ TG_PHONE: phone, TG_SESSION: session });
  console.log(`✓ Wrote TG_PHONE + TG_SESSION to ${ENV_PATH}`);
  console.log();
  console.log('Next:');
  console.log('  1. Optionally set ACCOUNT_ID, ACCOUNT_ROLE (cs|ad|hybrid) in .env');
  console.log('  2. Boot agent:  pnpm --filter @telehubx/agent run dev');
  console.log('     or via pm2:  pm2 start ecosystem.config.cjs --only telehubx-agent');
  console.log();
}

main().catch((err) => {
  console.error('✗ wizard crashed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
