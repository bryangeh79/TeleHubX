# build.ps1 -- TeleHubX installer end-to-end pipeline
#
# Usage (Windows PowerShell, repo root):
#   .\installer\build.ps1
#   .\installer\build.ps1 -SkipVendorCheck    # vendor missing OK (dev-mode dist)
#   .\installer\build.ps1 -SkipISCC           # assemble dist + SEA only, no Inno Setup
#
# Steps:
#   1) Vendor check (Node + Postgres Portable + Memurai)
#   2) build-dist.cjs (build 4 packages + assemble installer/dist)
#   3) secret-scan installer/dist (gate)
#   4) bundle supervisor / stop -> single-file cjs
#   5) Node SEA inject -> telehubx-supervisor.exe / telehubx-stop.exe
#   6) Stage SEA exe + assets/telehubx.ico -> installer/dist/{tools,assets}
#   7) ISCC.exe installer/telehubx.iss -> installer/Output/TeleHubX-Setup-*.exe
#
# Pure ASCII source (Windows PowerShell 5.1 parses regardless of code page).

[CmdletBinding()]
param(
  [switch]$SkipVendorCheck,
  [switch]$SkipISCC
)
$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

function Section($t) { Write-Host "`n========== $t ==========" -ForegroundColor Cyan }
function Step($t)    { Write-Host "[step] $t" -ForegroundColor White }
function Ok($t)      { Write-Host "  [ok] $t" -ForegroundColor Green }
function Die($t)     { Write-Host "[FATAL] $t" -ForegroundColor Red; exit 1 }

# ---- 1. vendor check ------------------------------------------------------
Section 'Vendor check'
$vendor = Join-Path $repoRoot 'vendor'
$nodeOk  = Test-Path (Join-Path $vendor 'node-v20-win-x64\node.exe')
$pgOk    = Test-Path (Join-Path $vendor 'postgres-16-portable\bin\postgres.exe')
$redisOk = Test-Path (Join-Path $vendor 'redis-windows\redis-server.exe')
Write-Host "  node:     $nodeOk"
Write-Host "  postgres: $pgOk"
Write-Host "  redis:    $redisOk"
if (-not ($nodeOk -and $pgOk -and $redisOk) -and -not $SkipVendorCheck) {
  Die 'vendor binaries incomplete. Run installer/scripts/fetch-vendor.ps1 first, OR pass -SkipVendorCheck for a dev-mode dist.'
}

# ---- 2. build-dist.cjs ----------------------------------------------------
Section 'Assemble dist'
Step 'node installer/build-dist.cjs'
$node = Get-Command node -ErrorAction Stop
& $node.Source 'installer/build-dist.cjs'
if ($LASTEXITCODE -ne 0) { Die 'build-dist.cjs failed' }
Ok 'dist assembled'

# ---- 3. secret-scan -------------------------------------------------------
Section 'Secret scan'
& $node.Source 'installer/scripts/secret-scan.mjs' 'installer/dist'
if ($LASTEXITCODE -ne 0) { Die 'secret-scan failed -- distribution would leak secrets' }
Ok 'no secrets in dist'

# ---- 4. bundle supervisor + stop ------------------------------------------
Section 'Bundle supervisor + stop'
& $node.Source 'installer/scripts/bundle-tools.cjs'
if ($LASTEXITCODE -ne 0) { Die 'bundle failed' }
Ok 'bundles produced at installer/tools/dist-bundle/'

# ---- 5. Node SEA -> exe ---------------------------------------------------
Section 'Node SEA -> exe'
$portableNode = Join-Path $vendor 'node-v20-win-x64\node.exe'
$nodeForSEA = if (Test-Path $portableNode) { $portableNode } else { (Get-Command node).Source }
Step "using node binary: $nodeForSEA"

$bundleDir = Join-Path $repoRoot 'installer\tools\dist-bundle'

function New-SeaExe {
  param([string]$ConfigPath, [string]$BlobPath, [string]$ExeName)
  Step "SEA $ExeName"
  # 1. generate blob
  & $nodeForSEA --experimental-sea-config $ConfigPath
  if ($LASTEXITCODE -ne 0) { Die "SEA generation failed for $ConfigPath" }

  # 2. copy node.exe -> target exe
  $exePath = Join-Path $bundleDir $ExeName
  Copy-Item -Force $nodeForSEA $exePath

  # 3. inject blob
  $postject = Join-Path $repoRoot 'node_modules\.bin\postject.cmd'
  if (-not (Test-Path $postject)) { $postject = Join-Path $repoRoot 'node_modules\.bin\postject' }
  if (-not (Test-Path $postject)) { Die 'postject not installed. Run: pnpm add -Dw postject' }
  & $postject $exePath NODE_SEA_BLOB $BlobPath `
      --sentinel-fuse 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  if ($LASTEXITCODE -ne 0) { Die "postject inject failed for $ExeName" }
  Ok "produced $exePath"
}

New-SeaExe -ConfigPath 'installer/sea-supervisor.json' -BlobPath (Join-Path $bundleDir 'supervisor.blob') -ExeName 'telehubx-supervisor.exe'
New-SeaExe -ConfigPath 'installer/sea-stop.json'       -BlobPath (Join-Path $bundleDir 'stop.blob')       -ExeName 'telehubx-stop.exe'

# ---- 6. Stage SEA exe + icon -> dist/tools, dist/assets -------------------
Section 'Stage SEA exe + icon'
$distTools  = Join-Path $repoRoot 'installer\dist\tools'
$distAssets = Join-Path $repoRoot 'installer\dist\assets'
$null = New-Item -ItemType Directory -Force $distTools
$null = New-Item -ItemType Directory -Force $distAssets

Copy-Item -Force (Join-Path $bundleDir 'telehubx-supervisor.exe') $distTools
Copy-Item -Force (Join-Path $bundleDir 'telehubx-stop.exe')       $distTools
Ok 'tools .exe staged'

$icoSrc = Join-Path $repoRoot 'installer\assets\telehubx.ico'
if (Test-Path $icoSrc) {
  Copy-Item -Force $icoSrc $distAssets
  Ok 'icon staged'
} else {
  Die 'installer/assets/telehubx.ico not found. Run: installer/scripts/png-to-ico.ps1 first.'
}

# ---- 6.5. SeedPack staging (vmfix22 / Issue #30) --------------------------
# Stage curated SeedPack content into installer/seedpack/staging/ so the
# main installer's [Files] section can embed it. This replaces the old
# separate TeleHubX-SeedPack-*.exe distribution — bundling everything
# into one .exe eliminates the sc stop/start race that bit vmfix20-21.
Section 'SeedPack staging (vmfix22: bundled into main installer)'
$seedScript = Join-Path $PSScriptRoot 'seedpack\build-seedpack.ps1'
if (Test-Path $seedScript) {
  & $seedScript -StagingOnly
  if ($LASTEXITCODE -ne 0) { Die 'SeedPack staging failed' }
  Ok 'SeedPack staging done'
} else {
  Write-Host '[warn] seedpack/build-seedpack.ps1 not found — main installer will NOT include builtin assets' -ForegroundColor Yellow
}

# ---- 7. ISCC.exe ----------------------------------------------------------
if ($SkipISCC) {
  Section 'Skipping ISCC (SkipISCC)'
  Write-Host 'Stop here: dist + tools/.exe + icon ready, but installer .exe not built.' -ForegroundColor Yellow
  exit 0
}
Section 'Inno Setup'
$iscc = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
$isccPath = $null
if ($iscc) { $isccPath = $iscc.Source }
if (-not $isccPath) {
  $candidates = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path $env:USERPROFILE 'AppData\Local\Programs\Inno Setup 6\ISCC.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $isccPath = $c; break }
  }
}
if (-not $isccPath) { Die 'ISCC.exe not found. Install Inno Setup 6 from https://jrsoftware.org/isdl.php' }
Step "using ISCC: $isccPath"
& $isccPath 'installer\telehubx.iss'
if ($LASTEXITCODE -ne 0) { Die 'ISCC.exe failed' }

$installer = Get-ChildItem 'installer\Output\TeleHubX-Setup-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($installer) { Ok "installer produced: $($installer.FullName)  ($([math]::Round($installer.Length/1MB,1)) MB)" }
else { Die 'ISCC ran but no Output\TeleHubX-Setup-*.exe found' }

Write-Host "`nAll done." -ForegroundColor Green
