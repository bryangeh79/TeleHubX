# build-patch.ps1 -- produce TeleHubX-Patch-{from}-to-{to}.zip
#
# Reads:
#   installer\patches\<targetVersion>.json   (release metadata)
#   installer\dist\                          (freshly built dist tree)
#
# Produces:
#   installer\Output\TeleHubX-Patch-{from}-to-{to}.zip
#   installer\Output\TeleHubX-Patch-{from}-to-{to}.zip.sha256
#
# Designed to be called from installer\build.ps1 as the final step,
# AFTER ISCC has built the full installer (so dist/apps/*/dist and
# dist/tools/telehubx-supervisor.exe are already current).
#
# Pure-ASCII source (Windows PowerShell 5.1 parses regardless of code page).

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$TargetVersion
)
$ErrorActionPreference = 'Stop'

function Section([string]$t) { Write-Host ("`n========== {0} ==========" -f $t) -ForegroundColor Cyan }
function Step([string]$t)    { Write-Host ("[step] {0}" -f $t) -ForegroundColor White }
function Ok([string]$t)      { Write-Host ("  [ok] {0}" -f $t) -ForegroundColor Green }
function Die([string]$t)     { Write-Host ("[FATAL] {0}" -f $t) -ForegroundColor Red; exit 1 }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

Section ("Patch build: {0}" -f $TargetVersion)

# 1. Load metadata
$metaFile = Join-Path $repoRoot ("installer\patches\{0}.json" -f $TargetVersion)
if (-not (Test-Path $metaFile)) { Die ("patch metadata not found: {0}" -f $metaFile) }
$meta = Get-Content $metaFile -Raw | ConvertFrom-Json
Ok ("loaded meta from {0}" -f $metaFile)
Write-Host ("  patchId      : {0}" -f $meta.patchId)
Write-Host ("  fromVersions : {0}" -f ($meta.fromVersions -join ', '))
Write-Host ("  toVersion    : {0}" -f $meta.toVersion)

# 2. Verify dist exists
$distRoot = Join-Path $repoRoot 'installer\dist'
if (-not (Test-Path $distRoot)) { Die "installer\dist not found - run build-dist.cjs first" }

# 3. Stage payload into temp dir
$stageRoot = Join-Path $repoRoot ("installer\Output\.patch-stage-{0}" -f $TargetVersion)
if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
$null = New-Item -ItemType Directory -Force $stageRoot
$payloadStage = Join-Path $stageRoot 'payload'
$null = New-Item -ItemType Directory -Force $payloadStage

Section 'Stage payload'
foreach ($p in $meta.payload) {
  $src = Join-Path $distRoot $p
  if (-not (Test-Path $src)) { Die ("payload entry not found in dist: {0} (looked at {1})" -f $p, $src) }
  $dst = Join-Path $payloadStage $p
  $dstParent = Split-Path $dst -Parent
  $null = New-Item -ItemType Directory -Force $dstParent -ErrorAction SilentlyContinue
  if ((Get-Item $src).PSIsContainer) {
    Copy-Item -Recurse -Force $src $dst
    $fileCount = (Get-ChildItem -Recurse -File $dst).Count
    $msg = "{0} [{1} files]" -f $p, $fileCount
    Ok $msg
  } else {
    $msg = "{0} [single file]" -f $p
    Copy-Item -Force $src $dst
    Ok $msg
  }
}

# 4. Compute manifest with buildAt + write to stage
$buildAtStr = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$manifestOut = [ordered]@{
  schemaVersion = $meta.schemaVersion
  patchId       = $meta.patchId
  fromVersions  = $meta.fromVersions
  toVersion     = $meta.toVersion
  buildAt       = $buildAtStr
  payload       = $meta.payload
  postPatchSql  = $meta.postPatchSql
  releaseNotes  = $meta.releaseNotes
}
$manifestPath = Join-Path $stageRoot 'patch-manifest.json'
($manifestOut | ConvertTo-Json -Depth 10) | Set-Content -Path $manifestPath -Encoding utf8
Ok 'wrote patch-manifest.json'

# 5. Zip up
Section 'Compress'
$fromTag = $meta.fromVersions[0]
$toTag = $meta.toVersion
$zipName = "TeleHubX-Patch-{0}-to-{1}.zip" -f $fromTag, $toTag
$zipPath = Join-Path $repoRoot ("installer\Output\{0}" -f $zipName)
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal -Force
$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
$zipMsg = "zip: {0} [{1} MB]" -f $zipPath, $sizeMB
Ok $zipMsg

# 6. SHA256 sidecar
$sha = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
$shaFile = "{0}.sha256" -f $zipPath
("{0}  {1}" -f $sha, $zipName) | Set-Content -Path $shaFile -Encoding ascii
Ok ("sha256: {0}" -f $sha)
Ok ("sidecar written: {0}" -f $shaFile)

# 7. Cleanup stage
Remove-Item -Recurse -Force $stageRoot

Section 'Patch build DONE'
Write-Host ("  Patch zip   : {0}" -f $zipPath) -ForegroundColor Green
Write-Host ("  SHA256      : {0}" -f $sha) -ForegroundColor Green
Write-Host ("  Size        : {0} MB" -f $sizeMB) -ForegroundColor Green
Write-Host ''
Write-Host '  Distribute both files (.zip and .zip.sha256) to tenants.' -ForegroundColor Gray
Write-Host '  Tenant runs: Apply-Patch.ps1 -PatchZip <path>' -ForegroundColor Gray
