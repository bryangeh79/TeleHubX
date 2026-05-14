# build-patch.ps1 — produce TeleHubX-Patch-{from}-to-{to}.zip
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

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string]$TargetVersion  # e.g. "vmfix30"
)
$ErrorActionPreference = 'Stop'

function Section($t) { Write-Host "`n========== $t ==========" -ForegroundColor Cyan }
function Step($t)    { Write-Host "[step] $t" -ForegroundColor White }
function Ok($t)      { Write-Host "  [ok] $t" -ForegroundColor Green }
function Die($t)     { Write-Host "[FATAL] $t" -ForegroundColor Red; exit 1 }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

Section "Patch build: $TargetVersion"

# 1. Load metadata
$metaFile = Join-Path $repoRoot "installer\patches\$TargetVersion.json"
if (-not (Test-Path $metaFile)) { Die "patch metadata not found: $metaFile" }
$meta = Get-Content $metaFile -Raw | ConvertFrom-Json
Ok "loaded meta from $metaFile"
Write-Host "  patchId      : $($meta.patchId)"
Write-Host "  fromVersions : $($meta.fromVersions -join ', ')"
Write-Host "  toVersion    : $($meta.toVersion)"

# 2. Verify dist exists
$distRoot = Join-Path $repoRoot 'installer\dist'
if (-not (Test-Path $distRoot)) { Die "installer\dist not found — run build-dist.cjs first" }

# 3. Stage payload into temp dir
$stageRoot = Join-Path $repoRoot "installer\Output\.patch-stage-$TargetVersion"
if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
$null = New-Item -ItemType Directory -Force $stageRoot
$payloadStage = Join-Path $stageRoot 'payload'
$null = New-Item -ItemType Directory -Force $payloadStage

Section 'Stage payload'
foreach ($p in $meta.payload) {
  $src = Join-Path $distRoot $p
  if (-not (Test-Path $src)) { Die "payload entry not found in dist: $p (looked at $src)" }
  $dst = Join-Path $payloadStage $p
  $dstParent = Split-Path $dst -Parent
  $null = New-Item -ItemType Directory -Force $dstParent -ErrorAction SilentlyContinue
  if ((Get-Item $src).PSIsContainer) {
    Copy-Item -Recurse -Force $src $dst
    $count = (Get-ChildItem -Recurse -File $dst).Count
    Ok "$p ($count files)"
  } else {
    Copy-Item -Force $src $dst
    Ok "$p (single file)"
  }
}

# 4. Compute manifest with buildAt + write to stage
$manifestOut = [ordered]@{
  schemaVersion = $meta.schemaVersion
  patchId       = $meta.patchId
  fromVersions  = $meta.fromVersions
  toVersion     = $meta.toVersion
  buildAt       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  payload       = $meta.payload
  postPatchSql  = $meta.postPatchSql
  releaseNotes  = $meta.releaseNotes
}
$manifestPath = Join-Path $stageRoot 'patch-manifest.json'
($manifestOut | ConvertTo-Json -Depth 10) | Set-Content -Path $manifestPath -Encoding utf8
Ok "wrote patch-manifest.json"

# 5. Zip up
Section 'Compress'
$fromTag = $meta.fromVersions[0]
$toTag = $meta.toVersion
$zipName = "TeleHubX-Patch-$fromTag-to-$toTag.zip"
$zipPath = Join-Path $repoRoot "installer\Output\$zipName"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

# Use Compress-Archive with -DestinationPath; works on PS 5.1+
Compress-Archive -Path "$stageRoot\*" -DestinationPath $zipPath -CompressionLevel Optimal -Force
$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Ok "zip: $zipPath ($sizeMB MB)"

# 6. SHA256 sidecar
$sha = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
$shaFile = "$zipPath.sha256"
"$sha  $zipName" | Set-Content -Path $shaFile -Encoding ascii
Ok "sha256: $sha"
Ok "sidecar written: $shaFile"

# 7. Cleanup stage
Remove-Item -Recurse -Force $stageRoot

Section 'Patch build DONE'
Write-Host "  Patch zip   : $zipPath" -ForegroundColor Green
Write-Host "  SHA256      : $sha" -ForegroundColor Green
Write-Host "  Size        : $sizeMB MB" -ForegroundColor Green
Write-Host ""
Write-Host "  Distribute both files (.zip and .zip.sha256) to tenants." -ForegroundColor Gray
Write-Host "  Tenant runs: Apply-Patch.ps1 -PatchZip <path>" -ForegroundColor Gray
