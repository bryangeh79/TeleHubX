import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * AES-256-GCM encrypted JSON storage for the cloud-license state.
 *
 * Key derivation:
 *   - If env LICENSE_LOCAL_KEY is set → scrypt(LICENSE_LOCAL_KEY, machineFp)
 *   - Otherwise → scrypt('telehubx-license-default', machineFp)
 *
 * The machine fingerprint is mixed into the key so an encrypted file
 * copied to another machine cannot be decrypted there.
 *
 * File format (all bytes):
 *   [magic 4 bytes "TLX1"] [iv 12] [tag 16] [ciphertext …]
 */

const MAGIC = Buffer.from('TLX1', 'utf8');
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const SALT = Buffer.from('telehubx-license-storage-v1');

export interface PersistedLicenseState {
  schemaVersion: 2;

  // Identity
  licenseKeyMasked: string;          // e.g. "THX-****-****-Z4RA"  for UI display
  machineFingerprint: string;
  agentToken: string;
  agentTokenExpiresAt: string | null;

  // From server
  licenseId: string;
  tenantName: string;
  plan: string;
  maxAccounts: number;
  expiresAt: string | null;

  // v2: tenant user identity (null when license has no user attached)
  userEmail: string | null;
  userRole: string | null;

  // Local state machine
  status: 'active' | 'revoked' | 'suspended' | 'expired' | 'unknown';
  activatedAt: string;

  // Verify telemetry
  lastVerifyAt: string | null;
  lastVerifyOkAt: string | null;
  lastVerifyError: string | null;
  consecutiveVerifyFailures: number;

  // Heartbeat telemetry
  lastHeartbeatAt: string | null;
  lastHeartbeatError: string | null;
}

function deriveKey(machineFp: string): Buffer {
  const passphrase = process.env.LICENSE_LOCAL_KEY ?? 'telehubx-license-default';
  return crypto.scryptSync(passphrase + ':' + machineFp, SALT, KEY_LEN);
}

export class LicenseStorage {
  constructor(private readonly file: string, private readonly machineFp: string) {}

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  read(): PersistedLicenseState | null {
    if (!this.exists()) return null;
    try {
      const buf = fs.readFileSync(this.file);
      if (buf.length < MAGIC.length + IV_LEN + TAG_LEN + 1) return null;
      if (!buf.subarray(0, 4).equals(MAGIC)) return null;
      const iv = buf.subarray(4, 4 + IV_LEN);
      const tag = buf.subarray(4 + IV_LEN, 4 + IV_LEN + TAG_LEN);
      const ct = buf.subarray(4 + IV_LEN + TAG_LEN);

      const key = deriveKey(this.machineFp);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      const obj = JSON.parse(pt.toString('utf8'));
      // v1 → upgrade in memory (add null user fields). It will be persisted
      // back as v2 on next write (e.g. next verify or heartbeat).
      if (obj?.schemaVersion === 1) {
        return {
          ...obj,
          schemaVersion: 2,
          userEmail: null,
          userRole: null,
        } as PersistedLicenseState;
      }
      if (obj?.schemaVersion !== 2) return null;
      return obj as PersistedLicenseState;
    } catch {
      return null;
    }
  }

  write(state: PersistedLicenseState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const key = deriveKey(this.machineFp);
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([
      cipher.update(JSON.stringify(state), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const out = Buffer.concat([MAGIC, iv, tag, ct]);
    // Atomic write: tmp → rename
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, out, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  delete(): void {
    try { fs.unlinkSync(this.file); } catch { /* ignore */ }
  }
}
