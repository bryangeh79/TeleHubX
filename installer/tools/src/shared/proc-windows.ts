import { spawnSync } from 'node:child_process';

export interface ProcInfo {
  pid: number;
  exePath: string | null;
  cmdLine: string | null;
  /** Unix epoch ms; null if parse fails */
  creationDate: number | null;
}

/**
 * 通过 PowerShell + Get-CimInstance 查 Win32_Process 信息。
 * 优先 PowerShell 而非 wmic（wmic 在 Windows 11 24H2 已弃用）。
 */
export function getProcessInfo(pid: number): ProcInfo | null {
  const psScript =
    `$ErrorActionPreference='SilentlyContinue';` +
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";` +
    `if ($p) { ` +
    `$obj = [PSCustomObject]@{ ` +
    `pid = [int]$p.ProcessId; ` +
    `exePath = $p.ExecutablePath; ` +
    `cmdLine = $p.CommandLine; ` +
    `creationDate = if ($p.CreationDate) { [int64]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } else { $null } ` +
    `}; ` +
    `$obj | ConvertTo-Json -Compress ` +
    `}`;
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', psScript],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.status !== 0) return null;
  const text = (r.stdout ?? '').trim();
  if (!text) return null;
  try {
    const o = JSON.parse(text);
    return {
      pid: Number(o.pid),
      exePath: o.exePath ?? null,
      cmdLine: o.cmdLine ?? null,
      creationDate: o.creationDate != null ? Number(o.creationDate) : null,
    };
  } catch {
    return null;
  }
}

/** taskkill /PID <pid> /T /F — 终止进程及其子树 */
export function killProcessTree(pid: number): { ok: boolean; stdout?: string; stderr?: string } {
  const r = spawnSync(
    'taskkill',
    ['/PID', String(pid), '/T', '/F'],
    { encoding: 'utf8', windowsHide: true },
  );
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
}

/** 检测 PID 是否仍存在（不发实际信号） */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true; // 进程存在但无权限发信号
    return false;
  }
}
