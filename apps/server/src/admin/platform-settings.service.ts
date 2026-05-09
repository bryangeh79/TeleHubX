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

    // vmfix24 (Issue #32): write to ALL .env candidates supervisor's
    // loadSupervisorEnv() reads. The previous vmfix23 implementation only
    // wrote to %ProgramData%\TeleHubX\.env, but supervisor reads %APPDATA%
    // \TeleHubX\.env FIRST (which for the LocalService account is at
    // C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\TeleHubX\.env).
    // bootstrapUserEnv copies the .env.template into that LocalService
    // profile location on first boot — and the template ships with
    // TG_API_ID= (empty), so on every subsequent supervisor boot
    // process.env.TG_API_ID gets set to "" by the userEnv candidate before
    // ProgramData\.env is even read, and "if (process.env[k] === undefined)"
    // skips the override. Net result: my saved value never reached the
    // BindService.
    //
    // Fix: write the new values to EVERY candidate file. First-read wins,
    // but every reader gets the right value.
    const writtenTo: string[] = [];
    for (const p of this.allEnvCandidates()) {
      try {
        this.writeEnvField(p, 'TG_API_ID', String(apiId));
        this.writeEnvField(p, 'TG_API_HASH', trimmedHash);
        writtenTo.push(p);
      } catch (e) {
        this.logger.warn(`platform settings: skipped writing ${p}: ${(e as Error).message}`);
      }
    }
    if (writtenTo.length === 0) {
      throw new Error('Could not write TG API credentials to any .env candidate path');
    }
    this.logger.log(`platform settings: TG_API_ID + TG_API_HASH saved to ${writtenTo.length} file(s): ${writtenTo.join(', ')}`);

    this.scheduleDetachedRestart();

    // Frontend should poll /health. Warm restart is ~3 minutes (init-pgdata
    // verify takes ~2 min + Nest boot ~40s). Give 5 minutes of buffer.
    return { restarting: true, expectedReadyMs: 300_000 };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  /**
   * Returns the list of .env file paths that supervisor's loadSupervisorEnv()
   * will read on next boot, in the order they're consulted (first hit wins).
   * vmfix24 (Issue #32): caller writes to ALL of them so the first reader
   * picks up the new value regardless of which file it was previously
   * caching from.
   *
   * Mirrors the candidate order in installer/tools/src/shared/env.ts
   * loadSupervisorEnv() — keep in sync if that file changes.
   */
  private allEnvCandidates(): string[] {
    const candidates: string[] = [];

    // 1. Per-user APPDATA path (PRIMARY for supervisor — wins on env load).
    //    For LocalService this is C:\Windows\ServiceProfiles\LocalService\AppData\Roaming
    const appdata = process.env.APPDATA;
    if (appdata) {
      candidates.push(path.join(appdata, 'TeleHubX', '.env'));
    }

    // 2. <dataDir>\..\.env  =  C:\ProgramData\TeleHubX\.env
    const dataDir = process.env.TELEHUBX_DATA_DIR;
    if (dataDir) {
      candidates.push(path.resolve(dataDir, '..', '.env'));
      // 3. <dataDir>\.env  =  C:\ProgramData\TeleHubX\data\.env (alt)
      candidates.push(path.resolve(dataDir, '.env'));
    }

    // 4. <installPath>\.env  =  C:\Program Files\TeleHubX\.env
    const installPath = process.env.TELEHUBX_INSTALL_PATH;
    if (installPath) {
      candidates.push(path.resolve(installPath, '.env'));
    }

    // 5. Dev fallback (workspace root)
    candidates.push(path.resolve(process.cwd(), '.env'));

    // De-duplicate (in case some env vars resolved to the same path)
    return Array.from(new Set(candidates));
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
