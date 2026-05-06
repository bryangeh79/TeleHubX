# fetch-vendor.ps1 -- prepare vendor/ binaries
#
# Usage (Windows PowerShell, repo root):
#   .\installer\scripts\fetch-vendor.ps1
#
# Behavior:
#   1. Auto-download Node v20 LTS Windows x64 -> vendor/node-v20-win-x64/
#   2. Auto-download Redis-for-Windows v5.0.14.1 -> vendor/redis-windows/
#      (tporadowski/redis fork; BSD-3-Clause; replaces Memurai)
#   3. Postgres Portable: prompt manual download (no public direct URL)
#   4. pgvector: prompt manual download (community Windows port)
#
# Pure ASCII source so Windows PowerShell 5.1 parses regardless of code page.

$ErrorActionPreference = 'Stop'

$RepoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$VendorDir  = Join-Path $RepoRoot 'vendor'
$null = New-Item -ItemType Directory -Force -Path $VendorDir

function Write-Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Write-Ok($t)      { Write-Host "  [ok] $t" -ForegroundColor Green }
function Write-Warn2($t)   { Write-Host "  [!!] $t" -ForegroundColor Yellow }

# ---- 1. Node v20 LTS ------------------------------------------------------
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
  Write-Ok "node.exe placed at $NodeExe"
}

# ---- 2. Redis for Windows (tporadowski/redis) -----------------------------
Write-Section 'Redis for Windows (tporadowski/redis, BSD-3-Clause)'
$RedisVersion = 'v5.0.14.1'
$RedisUrl     = "https://github.com/tporadowski/redis/releases/download/$RedisVersion/Redis-x64-5.0.14.1.zip"
$RedisDir     = Join-Path $VendorDir 'redis-windows'
$RedisExe     = Join-Path $RedisDir 'redis-server.exe'

if (Test-Path $RedisExe) {
  Write-Ok "already present: $RedisExe"
} else {
  $tmp = Join-Path $env:TEMP "redis-windows-$RedisVersion.zip"
  Write-Host "  downloading $RedisUrl ..."
  Invoke-WebRequest -Uri $RedisUrl -OutFile $tmp -UseBasicParsing
  Write-Host "  extracting ..."
  $null = New-Item -ItemType Directory -Force -Path $RedisDir
  Expand-Archive -LiteralPath $tmp -DestinationPath $RedisDir -Force
  Remove-Item -Force $tmp
  Write-Ok "redis-server.exe placed at $RedisExe"
}

# ---- 3. Postgres Portable v16 + pgvector (manual) -------------------------
Write-Section 'Postgres Portable v16 + pgvector'
$PgDir = Join-Path $VendorDir 'postgres-16-portable'
if (Test-Path (Join-Path $PgDir 'bin\postgres.exe')) {
  Write-Ok "already present: $PgDir"
} else {
  Write-Warn2 'manual step required:'
  Write-Host '    1) Download from:'
  Write-Host '       https://www.enterprisedb.com/download-postgresql-binaries'
  Write-Host '       choose Windows x86-64 v16.x  Binaries (zip)'
  Write-Host '    2) Extract zip and rename root folder to: postgres-16-portable'
  Write-Host "    3) Copy folder into: $VendorDir"
  Write-Host '    4) Verify:    vendor\postgres-16-portable\bin\postgres.exe exists'
  Write-Host ''
  Write-Host '    pgvector for PG16:'
  Write-Host '       https://github.com/andreiramani/pgvector_pgsql_windows/releases/tag/0.8.2_16.1'
  Write-Host '       (community Windows port; non-official; evaluate before production use)'
  Write-Host '       place files:'
  Write-Host '         vector.dll        into vendor\postgres-16-portable\lib\'
  Write-Host '         vector.control    into vendor\postgres-16-portable\share\extension\'
  Write-Host '         vector--*.sql     into vendor\postgres-16-portable\share\extension\'
}

# ---- 4. status summary ----------------------------------------------------
Write-Section 'Summary'
$nodeOk  = Test-Path $NodeExe
$redisOk = Test-Path $RedisExe
$pgOk    = Test-Path (Join-Path $PgDir 'bin\postgres.exe')

if ($nodeOk)  { Write-Ok 'node ready' }     else { Write-Warn2 'node missing' }
if ($redisOk) { Write-Ok 'redis ready' }    else { Write-Warn2 'redis missing' }
if ($pgOk)    { Write-Ok 'postgres ready' } else { Write-Warn2 'postgres missing -- manual step' }

if (-not ($nodeOk -and $redisOk -and $pgOk)) {
  Write-Host "`nNot all binaries present yet. After manual steps, re-run this script to verify." -ForegroundColor Yellow
  exit 1
}
Write-Host "`nAll vendor binaries ready. Next: node installer/build-dist.cjs" -ForegroundColor Green
exit 0
