import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Generate a stable machine fingerprint for the host running this server.
 *
 * Sources combined (all stable across reboots):
 *   - hostname
 *   - os.platform() / os.release()
 *   - first non-internal MAC address
 *   - server install dir absolute path (defends against simple VM clone)
 *
 * Output is hex-encoded SHA-256, 64 chars. Persisted to a file under the
 * data dir on first call so that even if one of the inputs changes (e.g.
 * NIC swap, hostname rename), subsequent runs keep using the original
 * fingerprint — until an admin deletes the file.
 */

const FILE_NAME = 'machine-fingerprint.txt';

export function getOrCreateMachineFingerprint(dataDir: string): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, FILE_NAME);
  try {
    const cached = fs.readFileSync(file, 'utf8').trim();
    if (cached && /^[a-f0-9]{32,}$/i.test(cached)) return cached;
  } catch {
    // not present yet — fall through to generate
  }

  const hostname = os.hostname();
  const platform = os.platform();
  const release = os.release();

  let firstMac = '';
  const ifs = os.networkInterfaces();
  outer: for (const list of Object.values(ifs)) {
    for (const ni of list ?? []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        firstMac = ni.mac;
        break outer;
      }
    }
  }

  const installDir = path.resolve(__dirname, '..', '..');
  const seed = [hostname, platform, release, firstMac, installDir].join('|');
  const fp = crypto.createHash('sha256').update(seed).digest('hex');

  try {
    fs.writeFileSync(file, fp + '\n', { mode: 0o600 });
  } catch {
    // best-effort persistence — if write fails we still return the fp
  }
  return fp;
}
