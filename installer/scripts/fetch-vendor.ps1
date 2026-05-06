# fetch-vendor.ps1 — 准备 vendor/ 二进制（Phase 3.5）
#
# 用法（Windows PowerShell, repo 根）:
#   .\installer\scripts\fetch-vendor.ps1
#
# 行为:
#   1. 下载 Node v20 LTS Windows x64 → vendor/node-v20-win-x64/node.exe (auto)
#   2. 提示 Postgres Portable + pgvector 下载链接 (manual, license 接受)
#   3. 提示 Memurai 下载链接 (manual, license 接受)
#
# Memurai 商业授权: Memurai Developer 仅供开发/测试; 生产部署需 Memurai Enterprise

$ErrorActionPreference = 'Stop'

$RepoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$VendorDir  = Join-Path $RepoRoot 'vendor'
$null = New-Item -ItemType Directory -Force -Path $VendorDir

function Write-Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok($t)      { Write-Host "  [ok] $t" -ForegroundColor Green }
function Write-Warn2($t)   { Write-Host "  [!!] $t" -ForegroundColor Yellow }

# ── 1. Node v20 LTS ──────────────────────────────────────────────────────────
Write-Section 'Node v20 LTS'
$NodeVersion = 'v20.18.0'
$NodeUrl     = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
$NodeDir     = Join-Path $VendorDir 'node-v20-win-x64'
$NodeExe     = Join-Path $NodeDir 'node.exe'

if (Test-Path $NodeExe) {
  Write-Ok "already present: $NodeExe"
} else {
  $tmp = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
  Write-Host "  downloading $NodeUrl ..."
  Invoke-WebRequest -Uri $NodeUrl -OutFile $tmp -UseBasicParsing
  Write-Host "  extracting ..."
  $extractDir = Join-Path $env:TEMP "node-extract-$([guid]::NewGuid())"
  Expand-Archive -LiteralPath $tmp -DestinationPath $extractDir -Force
  $inner = Get-ChildItem -Directory $extractDir | Select-Object -First 1
  $null = New-Item -ItemType Directory -Force -Path $NodeDir
  Copy-Item -Path (Join-Path $inner.FullName 'node.exe') -Destination $NodeExe -Force
  Remove-Item -Recurse -Force $extractDir
  Remove-Item -Force $tmp
  Write-Ok "node.exe → $NodeExe"
}

# ── 2. Postgres Portable v16 + pgvector (manual) ─────────────────────────────
Write-Section 'Postgres Portable v16 + pgvector'
$PgDir = Join-Path $VendorDir 'postgres-16-portable'
if (Test-Path (Join-Path $PgDir 'bin\postgres.exe')) {
  Write-Ok "already present: $PgDir"
} else {
  Write-Warn2 'manual step required:'
  Write-Host '    1) Download:'
  Write-Host '       https://www.enterprisedb.com/download-postgresql-binaries'
  Write-Host '       choose Windows x86-64 v16.x → "Binaries (zip)"'
  Write-Host '    2) Extract zip; rename root folder to: postgres-16-portable'
  Write-Host "    3) Copy folder into: $VendorDir"
  Write-Host '    4) Verify:    vendor\postgres-16-portable\bin\postgres.exe exists'
  Write-Host ''
  Write-Host '    pgvector:'
  Write-Host '       https://github.com/pgvector/pgvector/releases'
  Write-Host '       download Windows pre-built (or build from source)'
  Write-Host '       place files:'
  Write-Host '         vector.dll                      → vendor\postgres-16-portable\lib\'
  Write-Host '         vector.control                  → vendor\postgres-16-portable\share\extension\'
  Write-Host '         vector--*.sql                   → vendor\postgres-16-portable\share\extension\'
}

# ── 3. Memurai ───────────────────────────────────────────────────────────────
Write-Section 'Memurai (Redis-compatible)'
$MmDir = Join-Path $VendorDir 'memurai'
if (Test-Path (Join-Path $MmDir 'memurai.exe')) {
  Write-Ok "already present: $MmDir"
} else {
  Write-Warn2 'manual step required (also: confirm license):'
  Write-Host '    1) Visit https://www.memurai.com/get-memurai'
  Write-Host '    2) Choose "Memurai Developer" (free for dev/eval)'
  Write-Host '       OR "Memurai Enterprise" (paid, required for production)'
  Write-Host '    3) Install / extract; copy memurai.exe + memurai-cli.exe'
  Write-Host "       to: $MmDir"
  Write-Host ''
  Write-Host '    LICENSE NOTE: Memurai Developer EULA forbids production use.'
  Write-Host '    Before shipping installer to customers: confirm Memurai Enterprise.'
}

# ── 4. status summary ────────────────────────────────────────────────────────
Write-Section 'Summary'
$nodeOk = Test-Path $NodeExe
$pgOk   = Test-Path (Join-Path $PgDir 'bin\postgres.exe')
$mmOk   = Test-Path (Join-Path $MmDir 'memurai.exe')

if ($nodeOk) { Write-Ok 'node ready' } else { Write-Warn2 'node missing' }
if ($pgOk)   { Write-Ok 'postgres ready' } else { Write-Warn2 'postgres missing — manual step' }
if ($mmOk)   { Write-Ok 'memurai ready' } else { Write-Warn2 'memurai missing — manual step' }

if (-not ($nodeOk -and $pgOk -and $mmOk)) {
  Write-Host "`nNot all binaries present yet. After manual steps, re-run this script to verify." -ForegroundColor Yellow
  exit 1
}
Write-Host "`nAll vendor binaries ready. Next: node installer/build-dist.cjs" -ForegroundColor Green
