import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as os from 'os';
import * as path from 'path';
import { Account } from '../accounts/account.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { getDataPaths } from '../common/paths';
import { CloudLicenseClient, CloudLicenseError } from './cloud-license-client';
import {
  LicenseStorage,
  PersistedLicenseState,
} from './license-storage';
import { getOrCreateMachineFingerprint } from './machine-fingerprint';

/**
 * Local-side TeleHubX cloud-license enforcer.
 *
 * Responsibilities:
 *   - On boot, read encrypted local state.
 *   - First run: caller must POST /cloud-license/activate to bind machine.
 *   - Periodically POST /license/verify (every 30 min by default).
 *   - Periodically POST /agents/heartbeat (every 5 min by default).
 *   - Expose canAddAccount() and canRunTasks() so other services gate.
 *   - Grace period: transient API failures don't immediately lock down.
 *     Hard server statuses (revoked / suspended / expired) lock down
 *     immediately on the next verify.
 *
 * Sensitive values (license key plaintext, agentToken) are NEVER logged
 * in full — masked to prefix+suffix or fingerprint.
 */

const VERIFY_INTERVAL_MS_DEFAULT = 30 * 60 * 1000;       // 30 min
const HEARTBEAT_INTERVAL_MS_DEFAULT = 5 * 60 * 1000;     // 5 min
const STARTUP_DELAY_MS = 10_000;                         // wait 10s after boot before first verify
const GRACE_PERIOD_MS_DEFAULT = 24 * 60 * 60 * 1000;     // 24h since last successful verify
const VERIFY_FAIL_HARD_THRESHOLD_DEFAULT = 8;            // ≥8 consecutive verify failures → hard lock

const HARD_TERMINAL_CODES = new Set([
  'license_revoked', 'license_suspended', 'license_expired',
  'license_not_found', 'machine_mismatch',
  'user_disabled', 'user_not_found',
]);

export interface CloudLicenseStatus {
  configured: boolean;                                    // local state file exists
  licenseKeyMasked: string | null;
  machineFingerprint: string;
  tenantName: string | null;
  userEmail: string | null;
  userRole: string | null;
  plan: string | null;
  maxAccounts: number | null;
  expiresAt: string | null;
  status: PersistedLicenseState['status'];
  effectiveStatus: 'active' | 'grace' | 'locked' | 'unconfigured';
  activatedAt: string | null;
  lastVerifyAt: string | null;
  lastVerifyOkAt: string | null;
  lastVerifyError: string | null;
  consecutiveVerifyFailures: number;
  lastHeartbeatAt: string | null;
  lastHeartbeatError: string | null;
  serverBaseUrl: string;
}

export interface CloudLicenseGateInfo {
  ok: boolean;
  reason?: string;                                        // user-facing reason
  effectiveStatus: CloudLicenseStatus['effectiveStatus'];
}

@Injectable()
export class CloudLicenseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CloudLicenseService.name);

  private readonly baseUrl: string;
  private readonly client: CloudLicenseClient;
  private readonly storage: LicenseStorage;
  private readonly machineFp: string;
  private readonly agentVersion = process.env.npm_package_version ?? '1.0.0';
  private readonly verifyIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly graceMs: number;
  private readonly hardThreshold: number;

  private state: PersistedLicenseState | null = null;
  private verifyTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    config: ConfigService,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
  ) {
    this.baseUrl = config.get<string>('LICENSE_SERVER_URL')
      ?? 'https://telehubx-license.starbright-solutions.com';
    this.client = new CloudLicenseClient(this.baseUrl);

    const paths = getDataPaths(config);
    this.machineFp = getOrCreateMachineFingerprint(paths.root);
    this.storage = new LicenseStorage(paths.licenseFile, this.machineFp);

    this.verifyIntervalMs = Number(config.get('LICENSE_VERIFY_INTERVAL_MS')) || VERIFY_INTERVAL_MS_DEFAULT;
    this.heartbeatIntervalMs = Number(config.get('LICENSE_HEARTBEAT_INTERVAL_MS')) || HEARTBEAT_INTERVAL_MS_DEFAULT;
    this.graceMs = Number(config.get('LICENSE_GRACE_PERIOD_MS')) || GRACE_PERIOD_MS_DEFAULT;
    this.hardThreshold = Number(config.get('LICENSE_VERIFY_HARD_THRESHOLD')) || VERIFY_FAIL_HARD_THRESHOLD_DEFAULT;
  }

  onModuleInit(): void {
    this.state = this.storage.read();
    if (this.state) {
      this.logger.log(
        `cloud-license loaded: tenant=${this.state.tenantName} plan=${this.state.plan} ` +
        `maxAccounts=${this.state.maxAccounts} status=${this.state.status} ` +
        `key=${this.state.licenseKeyMasked} mfp=${this.fpPreview(this.state.machineFingerprint)}`,
      );
    } else {
      this.logger.warn('cloud-license: no local state — call POST /cloud-license/activate to bind machine');
    }
    // Start schedulers (no-op if not configured; verify path will short-circuit)
    setTimeout(() => this.runVerifyOnce().catch(() => {}), STARTUP_DELAY_MS);
    this.verifyTimer = setInterval(() => this.runVerifyOnce().catch(() => {}), this.verifyIntervalMs);
    this.heartbeatTimer = setInterval(() => this.runHeartbeatOnce().catch(() => {}), this.heartbeatIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.verifyTimer) clearInterval(this.verifyTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  // ─── Public surface ────────────────────────────────────────────────────

  /** Snapshot of license + machine state for the dashboard. */
  async status(): Promise<CloudLicenseStatus> {
    const eff = this.computeEffectiveStatus();
    return {
      configured: !!this.state,
      licenseKeyMasked: this.state?.licenseKeyMasked ?? null,
      machineFingerprint: this.fpPreview(this.machineFp),
      tenantName: this.state?.tenantName ?? null,
      userEmail: this.state?.userEmail ?? null,
      userRole: this.state?.userRole ?? null,
      plan: this.state?.plan ?? null,
      maxAccounts: this.state?.maxAccounts ?? null,
      expiresAt: this.state?.expiresAt ?? null,
      status: this.state?.status ?? 'unknown',
      effectiveStatus: eff,
      activatedAt: this.state?.activatedAt ?? null,
      lastVerifyAt: this.state?.lastVerifyAt ?? null,
      lastVerifyOkAt: this.state?.lastVerifyOkAt ?? null,
      lastVerifyError: this.state?.lastVerifyError ?? null,
      consecutiveVerifyFailures: this.state?.consecutiveVerifyFailures ?? 0,
      lastHeartbeatAt: this.state?.lastHeartbeatAt ?? null,
      lastHeartbeatError: this.state?.lastHeartbeatError ?? null,
      serverBaseUrl: this.baseUrl,
    };
  }

  /**
   * Activate a license key for this machine.
   *
   * Email and password are required as soon as the tenant has at least one
   * tenant_user on the License Worker side. Legacy/test tenants without
   * any user can pass null/null and the worker accepts it.
   */
  async activate(licenseKey: string, email?: string | null, password?: string | null): Promise<CloudLicenseStatus> {
    const trimmedKey = String(licenseKey ?? '').trim();
    if (!trimmedKey.startsWith('THX-')) {
      throw new CloudLicenseError(400, 'invalid_key_format', 'License key must start with THX-');
    }
    const trimmedEmail = email == null ? null : String(email).trim().toLowerCase();
    const passwordIn = password == null ? null : String(password);

    const res = await this.client.activate({
      licenseKey: trimmedKey,
      email: trimmedEmail,
      password: passwordIn,
      machineFingerprint: this.machineFp,
      hostname: os.hostname(),
      agentVersion: this.agentVersion,
    });
    const masked = `THX-****-****-${trimmedKey.slice(-4)}`;
    const now = new Date().toISOString();
    this.state = {
      schemaVersion: 2,
      licenseKeyMasked: masked,
      machineFingerprint: this.machineFp,
      agentToken: res.agentToken,
      agentTokenExpiresAt: res.agentTokenExpiresAt,
      licenseId: res.licenseId,
      tenantName: res.tenantName,
      plan: res.plan,
      maxAccounts: res.maxAccounts,
      expiresAt: res.expiresAt,
      userEmail: res.userEmail ?? null,
      userRole: res.userRole ?? null,
      status: 'active',
      activatedAt: now,
      lastVerifyAt: now,
      lastVerifyOkAt: now,
      lastVerifyError: null,
      consecutiveVerifyFailures: 0,
      lastHeartbeatAt: null,
      lastHeartbeatError: null,
    };
    this.storage.write(this.state);
    this.logger.log(
      `cloud-license activated: tenant=${res.tenantName} plan=${res.plan} ` +
      `maxAccounts=${res.maxAccounts} firstBind=${res.firstBind} key=${masked} ` +
      `user=${res.userEmail ?? '<none>'} role=${res.userRole ?? '<none>'}`,
    );
    return this.status();
  }

  /** Force a verify call now (for the dashboard's "refresh" button). */
  async refresh(): Promise<CloudLicenseStatus> {
    await this.runVerifyOnce();
    return this.status();
  }

  /** Wipe the local license. Use with care — caller should confirm. */
  unbindLocal(): void {
    this.state = null;
    this.storage.delete();
    this.logger.warn('cloud-license: local license state wiped');
  }

  // ─── Gates (called by AccountsService / TasksService) ─────────────────

  /** Block creating a new account if it would exceed maxAccounts. */
  async canAddAccount(): Promise<CloudLicenseGateInfo> {
    const eff = this.computeEffectiveStatus();
    if (eff === 'unconfigured') {
      return { ok: false, effectiveStatus: eff, reason: 'License not activated. Open Settings → License to activate.' };
    }
    if (eff === 'locked') {
      return { ok: false, effectiveStatus: eff, reason: this.lockReason() };
    }
    const max = this.state?.maxAccounts ?? 0;
    if (max <= 0) return { ok: false, effectiveStatus: eff, reason: 'License has no account quota' };
    const current = await this.accountRepo.count();
    if (current >= max) {
      return {
        ok: false,
        effectiveStatus: eff,
        reason: `Account quota reached (${current}/${max}). Upgrade plan or remove an account.`,
      };
    }
    return { ok: true, effectiveStatus: eff };
  }

  /** Block creating / dispatching a new task in locked state. */
  canRunTasks(): CloudLicenseGateInfo {
    const eff = this.computeEffectiveStatus();
    if (eff === 'unconfigured') {
      return { ok: false, effectiveStatus: eff, reason: 'License not activated. Open Settings → License to activate.' };
    }
    if (eff === 'locked') {
      return { ok: false, effectiveStatus: eff, reason: this.lockReason() };
    }
    return { ok: true, effectiveStatus: eff };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private computeEffectiveStatus(): CloudLicenseStatus['effectiveStatus'] {
    if (!this.state) return 'unconfigured';
    // server-confirmed terminal statuses → locked immediately
    if (this.state.status !== 'active') return 'locked';
    // server says expires_at passed → locked
    if (this.state.expiresAt && Date.parse(this.state.expiresAt) <= Date.now()) return 'locked';

    const failures = this.state.consecutiveVerifyFailures ?? 0;
    const lastOk = this.state.lastVerifyOkAt ? Date.parse(this.state.lastVerifyOkAt) : 0;
    const sinceOk = Date.now() - lastOk;

    if (failures === 0) return 'active';

    // Within grace? show 'grace' but allow operations.
    if (failures < this.hardThreshold && sinceOk < this.graceMs) return 'grace';

    // Exceeded grace → lock down
    return 'locked';
  }

  private lockReason(): string {
    if (!this.state) return 'License not configured';
    if (this.state.status === 'revoked') return 'License revoked by admin';
    if (this.state.status === 'suspended') return 'License suspended';
    if (this.state.status === 'expired') return 'License expired';
    if (this.state.expiresAt && Date.parse(this.state.expiresAt) <= Date.now()) return 'License expired';
    return `License unreachable (failed verify ${this.state.consecutiveVerifyFailures} times in a row, beyond ${Math.round(this.graceMs / 3_600_000)}h grace).`;
  }

  private async runVerifyOnce(): Promise<void> {
    if (!this.state?.agentToken) return;
    const now = new Date().toISOString();
    try {
      const res = await this.client.verify(this.state.agentToken);
      this.state = {
        ...this.state,
        plan: res.plan,
        maxAccounts: res.maxAccounts,
        expiresAt: res.expiresAt,
        // verify also returns the user (or null); keep local view in sync
        userEmail: res.userEmail ?? this.state.userEmail,
        userRole: res.userRole ?? this.state.userRole,
        status: 'active',
        lastVerifyAt: now,
        lastVerifyOkAt: now,
        lastVerifyError: null,
        consecutiveVerifyFailures: 0,
      };
      this.storage.write(this.state);
    } catch (err) {
      const e = err as CloudLicenseError;
      const code = e?.code ?? 'unknown';
      const failures = (this.state?.consecutiveVerifyFailures ?? 0) + 1;
      // hard terminal — lock immediately
      let nextStatus: PersistedLicenseState['status'] = this.state.status;
      if (HARD_TERMINAL_CODES.has(code)) {
        if (code === 'license_revoked') nextStatus = 'revoked';
        else if (code === 'license_suspended') nextStatus = 'suspended';
        else if (code === 'license_expired') nextStatus = 'expired';
        else nextStatus = 'unknown';
      }
      this.state = {
        ...this.state,
        status: nextStatus,
        lastVerifyAt: now,
        lastVerifyError: this.safeErrorMsg(e),
        consecutiveVerifyFailures: failures,
      };
      this.storage.write(this.state);
      this.logger.warn(`cloud-license verify failed (${failures}× in a row): ${code}`);
    }
  }

  private async runHeartbeatOnce(): Promise<void> {
    if (!this.state?.agentToken) return;
    // Only heartbeat if we're not hard-locked by a server status. Even in
    // grace we still heartbeat so the customer shows up as online.
    const eff = this.computeEffectiveStatus();
    if (eff === 'locked' && this.state.status !== 'active') return;

    const [localAccountCount, runningTaskCount] = await Promise.all([
      this.accountRepo.count().catch(() => 0),
      this.taskRepo.count({ where: { status: TaskStatus.RUNNING } }).catch(() => 0),
    ]);

    try {
      await this.client.heartbeat({
        agentToken: this.state.agentToken,
        localAccountCount,
        runningTaskCount,
        agentVersion: this.agentVersion,
      });
      this.state = {
        ...this.state,
        lastHeartbeatAt: new Date().toISOString(),
        lastHeartbeatError: null,
      };
      this.storage.write(this.state);
    } catch (err) {
      const e = err as CloudLicenseError;
      this.state = {
        ...this.state,
        lastHeartbeatAt: new Date().toISOString(),
        lastHeartbeatError: this.safeErrorMsg(e),
      };
      this.storage.write(this.state);
      // heartbeat failures don't escalate to lock by themselves —
      // verify is the source of truth for license status.
    }
  }

  private safeErrorMsg(e: any): string {
    const code = e?.code ?? 'unknown';
    const status = e?.httpStatus ?? '';
    return `${code}${status ? ` (HTTP ${status})` : ''}`;
  }

  private fpPreview(fp: string): string {
    return fp ? `${fp.slice(0, 8)}…${fp.slice(-4)}` : '';
  }
}
