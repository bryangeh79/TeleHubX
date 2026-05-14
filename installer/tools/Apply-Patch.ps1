# Apply-Patch.ps1 — TeleHubX Tier 2 patch applier (vmfix30+)
#
# Usage (must be Administrator):
#   .\Apply-Patch.ps1 -PatchZip "C:\Users\You\Downloads\TeleHubX-Patch-vmfix29.1-to-vmfix30.zip"
#
# Optional flags:
#   -ExpectedSha256 "<hex>"     # verify before applying; can also auto-read sidecar .sha256 file
#   -NoServiceRestart           # apply files but don't restart (use only for testing)
#   -NoBackup                   # skip backup step (NOT recommended — disables rollback)
#   -DryRun                     # validate manifest, print actions, do nothing
#
# What it does:
#   1. Verify zip SHA256
#   2. Extract patch-manifest.json
#   3. Check current installed version is in manifest.fromVersions
#   4. Confirm with operator (skip with -Yes)
#   5. Backup payload directories to <dataDir>/patches-backup/<timestamp>/
#   6. Stop TeleHubX service
#   7. Extract payload over C:\Program Files\TeleHubX\
#   8. Start service, wait for /health
#   9. Run postPatchSql against local Postgres
#   10. Write VERSION.txt
#   11. On any failure → rollback from backup → restart service → exit non-zero

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$PatchZip,
  [string]$ExpectedSha256,
  [switch]$NoServiceRestart,
  [switch]$NoBackup,
  [switch]$DryRun,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

# --- constants --------------------------------------------------------------
$InstallRoot = 'C:\Program Files\TeleHubX'
$DataRoot    = 'C:\ProgramData\TeleHubX\data'
$ServiceName = 'TeleHubX'
$HealthUrl   = 'http://127.0.0.1:9800/health'
$HealthTimeoutSec = 180
$PgPort      = 5436
$DbName      = 'telehubx'
$DbUser      = 'telehubx'

# --- helpers ----------------------------------------------------------------
function Say([string]$m, [string]$c = 'White') { Write-Host $m -ForegroundColor $c }
function Section([string]$t) { Write-Host "`n========== $t ==========" -ForegroundColor Cyan }
function Step([string]$t)    { Write-Host "[step] $t" -ForegroundColor White }
function Ok([string]$t)      { Write-Host "  [ok] $t" -ForegroundColor Green }
function Warn([string]$t)    { Write-Host "  [warn] $t" -ForegroundColor Yellow }
function Die([string]$t)     { Write-Host "[FATAL] $t" -ForegroundColor Red; throw $t }

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CurrentVersion {
  $verFile = Join-Path $InstallRoot 'VERSION.txt'
  if (Test-Path $verFile) { return (Get-Content $verFile -Raw).Trim() }
  return $null
}

function Compute-FileSha256([string]$path) {
  return (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
}

function Get-DbPassword {
  $envFile = Join-Path $DataRoot '..\\.env'
  $envFile = (Resolve-Path $envFile -ErrorAction SilentlyContinue)
  if (-not $envFile) { $envFile = 'C:\ProgramData\TeleHubX\.env' }
  if (-not (Test-Path $envFile)) { Die "cannot find .env at $envFile to read DB_PASSWORD" }
  $line = (Get-Content $envFile | Where-Object { $_ -match '^DB_PASSWORD\s*=' } | Select-Object -First 1)
  if (-not $line) { Die "DB_PASSWORD not in $envFile" }
  return ($line -split '=', 2)[1].Trim()
}

# --- 0. preflight -----------------------------------------------------------
Section 'Preflight'
if (-not (Test-IsAdmin)) { Die 'must be run as Administrator (right-click PowerShell → Run as Admin)' }
if (-not (Test-Path $PatchZip)) { Die "patch zip not found: $PatchZip" }
if (-not (Test-Path $InstallRoot)) { Die "TeleHubX install not found at $InstallRoot" }
$svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) { Die "WinSW service '$ServiceName' not registered. Use full installer instead of patch." }
Ok "service status before: $($svc.Status)"

$currentVer = Get-CurrentVersion
Say "  current version : $currentVer"
Say "  patch zip       : $PatchZip"
Say "  zip size        : $([math]::Round((Get-Item $PatchZip).Length / 1MB, 1)) MB"

# --- 1. verify SHA256 -------------------------------------------------------
Section 'Verify zip SHA256'
$actualSha = Compute-FileSha256 $PatchZip
Say "  actual SHA256   : $actualSha"

if (-not $ExpectedSha256) {
  # auto-detect sidecar .sha256 file
  $sidecar = "$PatchZip.sha256"
  if (Test-Path $sidecar) {
    $ExpectedSha256 = ((Get-Content $sidecar -Raw).Trim() -split '\s+')[0].ToLower()
    Say "  loaded sidecar  : $sidecar"
  }
}

if ($ExpectedSha256) {
  $ExpectedSha256 = $ExpectedSha256.ToLower()
  Say "  expected SHA256 : $ExpectedSha256"
  if ($actualSha -ne $ExpectedSha256) {
    Die "SHA256 mismatch — zip may be corrupted or tampered. Re-download."
  }
  Ok 'SHA256 verified'
} else {
  Warn 'no ExpectedSha256 provided and no .sha256 sidecar found — skipping integrity check (NOT RECOMMENDED)'
}

# --- 2. extract + read manifest ---------------------------------------------
Section 'Read patch manifest'
$tmpDir = Join-Path $env:TEMP "TeleHubX-Patch-$([Guid]::NewGuid().ToString('N'))"
$null = New-Item -ItemType Directory -Force $tmpDir
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($PatchZip, $tmpDir)
  Ok "extracted to $tmpDir"
} catch {
  Die "extract failed: $_"
}

$manifestPath = Join-Path $tmpDir 'patch-manifest.json'
if (-not (Test-Path $manifestPath)) { Die 'patch-manifest.json missing in zip root' }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

Say "  patchId         : $($manifest.patchId)"
Say "  fromVersions    : $($manifest.fromVersions -join ', ')"
Say "  toVersion       : $($manifest.toVersion)"
Say "  payload         : $($manifest.payload -join ', ')"
Say "  postPatchSql    : $($manifest.postPatchSql.Count) statement(s)"

# --- 3. version gate --------------------------------------------------------
Section 'Version gate'
if (-not $currentVer) {
  Warn 'no current VERSION.txt — assuming new install, will accept any patch'
} elseif ($manifest.fromVersions -notcontains $currentVer) {
  Die "current version '$currentVer' not in patch.fromVersions ($($manifest.fromVersions -join ', ')). Use the right patch or full installer."
} else {
  Ok "current version '$currentVer' accepted"
}

# --- 4. release notes + confirm ---------------------------------------------
Section 'Release notes'
Write-Host $manifest.releaseNotes -ForegroundColor Gray

if ($DryRun) {
  Section 'Dry run'
  Say '  --DryRun set, stopping here. No changes made.'
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
}

if (-not $Yes) {
  Write-Host ''
  $ans = Read-Host "Proceed with applying $($manifest.patchId)? [y/N]"
  if ($ans -notmatch '^[Yy]') {
    Warn 'cancelled by user'
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
  }
}

# --- 5. backup --------------------------------------------------------------
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $DataRoot "patches-backup\$ts-$($manifest.patchId)"

if (-not $NoBackup) {
  Section 'Backup'
  $null = New-Item -ItemType Directory -Force $backupDir
  foreach ($p in $manifest.payload) {
    $src = Join-Path $InstallRoot $p
    if (-not (Test-Path $src)) { Warn "payload entry not present in current install: $p (skipping backup)"; continue }
    $dst = Join-Path $backupDir $p
    $dstParent = Split-Path $dst -Parent
    $null = New-Item -ItemType Directory -Force $dstParent -ErrorAction SilentlyContinue
    if ((Get-Item $src).PSIsContainer) {
      Copy-Item -Recurse -Force $src $dst
    } else {
      Copy-Item -Force $src $dst
    }
  }
  $verFile = Join-Path $InstallRoot 'VERSION.txt'
  if (Test-Path $verFile) { Copy-Item -Force $verFile (Join-Path $backupDir 'VERSION.txt') }
  Ok "backup saved to $backupDir"
} else {
  Warn 'backup skipped (NoBackup) — rollback NOT possible if apply fails'
}

# --- 6. stop service --------------------------------------------------------
$rollbackInProgress = $false
function Invoke-Rollback {
  if ($NoBackup) { Warn 'cannot rollback (NoBackup was set)'; return }
  if ($rollbackInProgress) { return }
  $script:rollbackInProgress = $true
  Section 'ROLLBACK'
  try { Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3 } catch {}
  foreach ($p in $manifest.payload) {
    $src = Join-Path $backupDir $p
    $dst = Join-Path $InstallRoot $p
    if (-not (Test-Path $src)) { continue }
    if ((Get-Item $src).PSIsContainer) {
      if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
      Copy-Item -Recurse -Force $src $dst
    } else {
      Copy-Item -Force $src $dst
    }
  }
  $verBak = Join-Path $backupDir 'VERSION.txt'
  if (Test-Path $verBak) { Copy-Item -Force $verBak (Join-Path $InstallRoot 'VERSION.txt') }
  Start-Service $ServiceName -ErrorAction SilentlyContinue
  Warn "rolled back to backup $backupDir"
}

if (-not $NoServiceRestart) {
  Section 'Stop service'
  try {
    Stop-Service $ServiceName -Force
    # Wait until ports release
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      $svc = Get-Service $ServiceName
      if ($svc.Status -eq 'Stopped') { break }
      Start-Sleep -Seconds 2
    }
    Ok "service stopped"
  } catch {
    Die "failed to stop service: $_"
  }
}

# --- 7. apply payload -------------------------------------------------------
Section 'Apply payload'
$payloadRoot = Join-Path $tmpDir 'payload'
if (-not (Test-Path $payloadRoot)) { Invoke-Rollback; Die 'payload/ missing in zip' }

try {
  foreach ($p in $manifest.payload) {
    $src = Join-Path $payloadRoot $p
    $dst = Join-Path $InstallRoot $p
    if (-not (Test-Path $src)) { Invoke-Rollback; Die "payload entry missing in zip: $p" }
    $dstParent = Split-Path $dst -Parent
    $null = New-Item -ItemType Directory -Force $dstParent -ErrorAction SilentlyContinue
    if ((Get-Item $src).PSIsContainer) {
      # Remove existing then copy
      if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
      Copy-Item -Recurse -Force $src $dst
      Ok "applied: $p (dir)"
    } else {
      Copy-Item -Force $src $dst
      Ok "applied: $p (file)"
    }
  }
} catch {
  Invoke-Rollback
  Die "apply failed: $_"
}

# Write VERSION.txt
$verFile = Join-Path $InstallRoot 'VERSION.txt'
Set-Content -Path $verFile -Value $manifest.toVersion -NoNewline
Ok "VERSION.txt = $($manifest.toVersion)"

# --- 8. start service + health probe ----------------------------------------
if (-not $NoServiceRestart) {
  Section 'Start service'
  try { Start-Service $ServiceName } catch { Invoke-Rollback; Die "start failed: $_" }

  Section 'Health probe'
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod $HealthUrl -TimeoutSec 5
      if ($r.status -eq 'ok') { $healthy = $true; break }
    } catch { Start-Sleep -Seconds 3 }
  }
  if (-not $healthy) {
    Invoke-Rollback
    Die "service did not become healthy within $HealthTimeoutSec sec. Rolled back."
  }
  Ok 'service healthy'
}

# --- 9. postPatchSql --------------------------------------------------------
if ($manifest.postPatchSql -and $manifest.postPatchSql.Count -gt 0) {
  Section 'postPatchSql'
  $psql = Join-Path $InstallRoot 'runtime\postgres\bin\psql.exe'
  if (-not (Test-Path $psql)) { Warn "psql.exe not found at $psql — SKIPPING postPatchSql (run manually if needed)" }
  else {
    try { $pw = Get-DbPassword } catch { Warn "cannot read DB_PASSWORD: $_ — SKIPPING postPatchSql"; $pw = $null }
    if ($pw) {
      $env:PGPASSWORD = $pw
      $idx = 0
      foreach ($sql in $manifest.postPatchSql) {
        $idx++
        Step "[$idx/$($manifest.postPatchSql.Count)] $sql"
        try {
          & $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -c $sql
          if ($LASTEXITCODE -ne 0) { Warn "  exit $LASTEXITCODE — postPatchSql statement did not succeed (continuing)" }
          else { Ok "applied" }
        } catch {
          Warn "  statement error: $_ (continuing)"
        }
      }
      $env:PGPASSWORD = $null
    }
  }
}

# --- 10. cleanup ------------------------------------------------------------
Section 'Cleanup'
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
Ok "tmp removed"
if (-not $NoBackup) { Say "  backup retained at: $backupDir" }

Section 'DONE'
Say "TeleHubX patched: $currentVer -> $($manifest.toVersion)" 'Green'
Say "  Service status : $((Get-Service $ServiceName).Status)"
Say "  Dashboard      : http://127.0.0.1:9601/"
