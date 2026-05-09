# build-seedpack.ps1 -- TeleHubX SeedPack v1 installer build
#
# Pipeline:
#   1) Stage curated content from data/assets/* and data/script-packs/*
#      into installer/seedpack/staging/
#   2) Run ISCC on installer/seedpack/seedpack.iss
#      -> installer/Output/TeleHubX-SeedPack-1.0.0-vmfix20.exe
#
# This is a SEPARATE installer from the main TeleHubX-Setup-*.exe. Runs
# AFTER the main installer is in place; drops files under
# %ProgramData%\TeleHubX\data\assets\_builtin\ and
# %ProgramData%\TeleHubX\data\script-packs\, then restarts the service so
# AssetsService.onModuleInit + ChatScriptsService.onModuleInit pick up the
# new files.
#
# Curation rules (kept ~50MB):
#   - All images       (~6 MB)
#   - All voices       (~2.6 MB)
#   - 5 smallest videos per category (~40 MB total)
#   - Both ChatScripts pack JSONs from data/script-packs/ (NOT archived/)

[CmdletBinding()]
param(
  [switch]$SkipISCC,
  [int]$VideosPerCategory = 5
)
$ErrorActionPreference = 'Stop'
$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$dataDir    = Join-Path $repoRoot 'data'
$staging    = Join-Path $PSScriptRoot 'staging'
$outputDir  = Join-Path $repoRoot 'installer\Output'

function Section($t) { Write-Host "`n========== $t ==========" -ForegroundColor Cyan }
function Step($t)    { Write-Host "[step] $t" -ForegroundColor White }
function Ok($t)      { Write-Host "  [ok] $t" -ForegroundColor Green }
function Die($t)     { Write-Host "[FATAL] $t" -ForegroundColor Red; exit 1 }

# ---- 1. Validate source content -------------------------------------------
Section 'Validate seed source'
$srcAssets  = Join-Path $dataDir 'assets'
$srcPacks   = Join-Path $dataDir 'script-packs'
if (-not (Test-Path $srcAssets)) { Die "$srcAssets not found. Cannot build SeedPack without source content." }
if (-not (Test-Path $srcPacks))  { Die "$srcPacks not found. Cannot build SeedPack without script packs." }
Ok "source content found"

# ---- 2. Clean staging -----------------------------------------------------
Section 'Clean staging'
if (Test-Path $staging) {
  Remove-Item -Recurse -Force $staging
}
$null = New-Item -ItemType Directory -Force $staging
$null = New-Item -ItemType Directory -Force (Join-Path $staging 'assets\_builtin')
$null = New-Item -ItemType Directory -Force (Join-Path $staging 'script-packs')
Ok "staging cleaned: $staging"

# ---- 3. Stage images ------------------------------------------------------
Section 'Stage images (all)'
$imgSrc = Join-Path $srcAssets 'images'
$imgDst = Join-Path $staging 'assets\_builtin\images'
if (Test-Path $imgSrc) {
  Copy-Item -Recurse -Force $imgSrc $imgDst
  $imgCount = (Get-ChildItem -Recurse -File $imgDst).Count
  Ok "images: $imgCount files"
} else {
  Write-Host "[warn] no images dir at $imgSrc" -ForegroundColor Yellow
}

# ---- 4. Stage voices ------------------------------------------------------
Section 'Stage voices (all)'
$voSrc = Join-Path $srcAssets 'voices'
$voDst = Join-Path $staging 'assets\_builtin\voices'
if (Test-Path $voSrc) {
  Copy-Item -Recurse -Force $voSrc $voDst
  $voCount = (Get-ChildItem -Recurse -File $voDst).Count
  Ok "voices: $voCount files"
} else {
  Write-Host "[warn] no voices dir at $voSrc" -ForegroundColor Yellow
}

# ---- 5. Stage videos (curated: top N smallest per category) ---------------
Section "Stage videos (top $VideosPerCategory smallest per category)"
$vidSrc = Join-Path $srcAssets 'videos'
$vidDst = Join-Path $staging 'assets\_builtin\videos'
if (Test-Path $vidSrc) {
  $catDirs = Get-ChildItem -Directory $vidSrc
  foreach ($cat in $catDirs) {
    $picked = Get-ChildItem -File $cat.FullName |
      Sort-Object Length |
      Select-Object -First $VideosPerCategory
    $catDst = Join-Path $vidDst $cat.Name
    $null = New-Item -ItemType Directory -Force $catDst
    foreach ($v in $picked) {
      Copy-Item -Force $v.FullName (Join-Path $catDst $v.Name)
    }
    $totalSizeMB = [math]::Round((($picked | Measure-Object Length -Sum).Sum / 1MB), 1)
    Ok "videos/$($cat.Name): $($picked.Count) files, $totalSizeMB MB"
  }
} else {
  Write-Host "[warn] no videos dir at $vidSrc" -ForegroundColor Yellow
}

# ---- 6. Stage script-packs (skip archived/) -------------------------------
Section 'Stage script-packs'
$jsonFiles = Get-ChildItem -File $srcPacks -Filter '*.json'
$packsDst  = Join-Path $staging 'script-packs'
foreach ($j in $jsonFiles) {
  Copy-Item -Force $j.FullName (Join-Path $packsDst $j.Name)
}
Ok "script-packs: $($jsonFiles.Count) JSON files"

# ---- 7. Total size summary ------------------------------------------------
Section 'Staging summary'
$total = (Get-ChildItem -Recurse -File $staging | Measure-Object Length -Sum).Sum
$totalMB = [math]::Round($total / 1MB, 1)
Write-Host "Total staged: $totalMB MB" -ForegroundColor White

# ---- 8. ISCC --------------------------------------------------------------
if ($SkipISCC) {
  Section 'Skipping ISCC (SkipISCC)'
  Write-Host "Staging at: $staging" -ForegroundColor Yellow
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
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $isccPath = $c; break }
  }
}
if (-not $isccPath) { Die 'ISCC.exe not found.' }

$issPath = Join-Path $PSScriptRoot 'seedpack.iss'
& $isccPath $issPath
if ($LASTEXITCODE -ne 0) { Die "ISCC.exe failed (exit $LASTEXITCODE)" }

$produced = Get-ChildItem $outputDir -Filter 'TeleHubX-SeedPack-*.exe' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($produced) {
  Ok "SeedPack produced: $($produced.FullName)  ($([math]::Round($produced.Length / 1MB, 1)) MB)"
} else {
  Die 'ISCC ran but no Output\TeleHubX-SeedPack-*.exe found'
}

Write-Host "`nAll done." -ForegroundColor Green
