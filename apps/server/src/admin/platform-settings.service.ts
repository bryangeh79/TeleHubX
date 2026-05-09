import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataPaths } from '../common/paths';

/**
 * vmfix23 (Issue #31): platform-level settings that aren't per-tenant.
 *
 * For now: TG_API_ID + TG_API_HASH (Telegram MTProto credentials). The
 * tenant admin pastes these from https://my.telegram.org/apps; we write
 * them to %ProgramData%\TeleHubX\data\.env and trigger a service restart
 * so the BindService re-reads them via ConfigService on next boot.
 *
 * Why .env instead of DB:
 *   - BindService (and agent) read process.env.TG_API_ID at constructor
 *     time. DB-backed hot-reload would require refactoring every callsite.
 *   - The .env file is owned by LocalService (icacls grant from main
 *     installer), readable+writable.
 *   - Restart cost is acceptable (~60 s) since this is a once-per-tenant
 *     setup action.
 *
 * Phase 6 will move this to per-tenant TenantSettings.tgApiId so multiple
 * tenants don't share one TG app.
 */
@Injectable()
export class PlatformSettingsService {
  private readonly logger = new Logger(PlatformSettingsService.name);

  constructor(private readonly config: ConfigService) {}

  /** Read current values via ConfigService (which already merged process.env + .env). */
  getTgApi(): { configured: boolean; apiId: number | null; apiHashMasked: string | null } {
    const idRaw = this.config.get<string>('TG_API_ID', '');
    const hash = this.config.get<string>('TG_API_HASH', '');
    const apiId = parseInt(idRaw, 10) || 0;
    const configured = Boolean(apiId && hash && hash.length >= 16);
    return {
      configured,
      apiId: configured ? apiId : null,
      apiHashMasked: configured ? this.maskHash(hash) : null,
    };
  }

  /**
   * Write TG_API_ID + TG_API_HASH to .env on disk and trigger an
   * out-of-band service restart so the new values take effect.
   *
   * Validation:
   *   apiId    -> positive integer, telegram allocates 7-9 digit IDs
   *   apiHash  -> 32-char lowercase hex string
   */
  async saveTgApiAndRestart(apiId: number, apiHash: string): Promise<{ restarting: boolean; expectedReadyMs: number }> {
    if (!Number.isInteger(apiId) || apiId <= 0 || apiId > 999_999_999) {
      throw new BadRequestException('apiId must be a positive integer between 1 and 999,999,999');
    }
    const trimmedHash = String(apiHash ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(trimmedHash)) {
      throw new BadRequestException('apiHash must be a 32-character lowercase hex string');
    }

    const envPath = this.resolveEnvPath();
    this.writeEnvField(envPath, 'TG_API_ID', String(apiId));
    this.writeEnvField(envPath, 'TG_API_HASH', trimmedHash);
    this.logger.log(`platform settings: TG_API_ID + TG_API_HASH saved to ${envPath}`);

    this.scheduleDetachedRestart();

    // Frontend should poll /health and expect ready within ~90 s on warm restart.
    return { restarting: true, expectedReadyMs: 90_000 };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private resolveEnvPath(): string {
    // Installer's WinSW XML sets TELEHUBX_INSTALL_PATH; .env lives at <installPath>/.env
    // (per main installer's [Run] /C copy template -> {commonappdata}\TeleHubX\.env at first
    //  install.) But supervisor actually writes .env to %ProgramData%\TeleHubX\.env (the
    // canonical machine-wide location), and child processes read it from there. Try both.
    const candidates: string[] = [];
    const dataDir = process.env.TELEHUBX_DATA_DIR;
    if (dataDir) {
      candidates.push(path.resolve(dataDir, '..', '.env')); // %ProgramData%\TeleHubX\.env
      candidates.push(path.resolve(dataDir, '.env'));        // %ProgramData%\TeleHubX\data\.env
    }
    const installPath = process.env.TELEHUBX_INSTALL_PATH;
    if (installPath) {
      candidates.push(path.resolve(installPath, '.env'));
    }
    // Dev fallback
    candidates.push(path.resolve(process.cwd(), '.env'));

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    // None exist — write to the first canonical candidate (creates if missing)
    if (candidates.length) return candidates[0];
    throw new Error('No .env path could be determined (no TELEHUBX_DATA_DIR / TELEHUBX_INSTALL_PATH set)');
  }

  /**
   * Replace KEY=value line in .env if it exists, else append. Preserves
   * other lines and comments. Doesn't try to parse — line-oriented edit.
   */
  private writeEnvField(envPath: string, key: string, value: string): void {
    const dir = path.dirname(envPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let content = '';
    try { content = fs.readFileSync(envPath, 'utf8'); } catch { /* file missing — start empty */ }
    const lineRe = new RegExp(`^${key}=.*$`, 'm');
    const newLine = `${key}=${value}`;
    if (lineRe.test(content)) {
      content = content.replace(lineRe, newLine);
    } else {
      if (content.length && !content.endsWith('\n')) content += '\n';
      content += newLine + '\n';
    }
    fs.writeFileSync(envPath, content, { encoding: 'utf8' });
  }

  /**
   * Spawn a detached cmd.exe that:
   *   1. waits 3 seconds (lets the HTTP response we're about to return finish)
   *   2. sc stop TeleHubX (kills server, supervisor, postgres, redis, dashboard)
   *   3. waits 12 seconds (postgres pg_ctl-stop teardown + lock release)
   *   4. sc start TeleHubX (full cold restart with new env values)
   *
   * Detached + unref() means the child cmd.exe outlives this server
   * process. server.exe gets killed by sc stop in step 2; the cmd
   * keeps running and issues sc start in step 4.
   */
  private scheduleDetachedRestart(): void {
    const cmd = [
      'timeout /t 3 /nobreak > nul',
      'sc.exe stop TeleHubX',
      'timeout /t 12 /nobreak > nul',
      'sc.exe start TeleHubX',
    ].join(' && ');
    const child = spawn('cmd.exe', ['/C', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    this.logger.warn('platform settings: scheduled detached service restart in 3 s');
  }

  private maskHash(hash: string): string {
    if (hash.length <= 8) return hash;
    return `${hash.slice(0, 4)}...${hash.slice(-4)} (${hash.length} chars)`;
  }
}
