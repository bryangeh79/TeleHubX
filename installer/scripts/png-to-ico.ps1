# png-to-ico.ps1 -- Logo PNG -> multi-size .ico (256/128/64/48/32/16)
#                   plus optional Inno Setup banner BMPs
#
# Usage:
#   .\installer\scripts\png-to-ico.ps1 `
#       -Source installer\assets\telehubx-logo.png `
#       -Out    installer\assets\telehubx.ico
#
# Pure ASCII source (Windows PowerShell 5.1 parses correctly regardless
# of system code page; do not introduce arrows, em-dashes, box-drawing
# characters, or smart quotes here).
#
# Depends only on .NET / GDI+ (PowerShell built-in, no external tools).
# BMP generation is optional and degrades gracefully on GDI+ failure.

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Out
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) { throw "Source PNG not found: $Source" }
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out)

Add-Type -AssemblyName System.Drawing

# Resolve to absolute paths early so GDI+ does not choke on cwd-relative paths.
$SourceAbs = (Resolve-Path -LiteralPath $Source).Path
$OutDirAbs = (Resolve-Path -LiteralPath (Split-Path -Parent $Out)).Path
$OutAbs    = Join-Path $OutDirAbs (Split-Path -Leaf $Out)

function New-IconFromPng {
  param([string]$Png, [string]$IcoPath)

  $sizes = 256, 128, 64, 48, 32, 16
  $src = [System.Drawing.Image]::FromFile($Png)

  # Multi-size ICO format: ICONDIR (6 bytes) + N ICONDIRENTRY (16 bytes each)
  # + N PNG payloads concatenated.
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)

  # ICONDIR
  $bw.Write([UInt16]0)               # reserved
  $bw.Write([UInt16]1)               # type = icon
  $bw.Write([UInt16]$sizes.Count)    # # of images

  $payloads = @()
  foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()
    $pngStream = New-Object System.IO.MemoryStream
    $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $payloads += ,@{ size = $s; bytes = $pngStream.ToArray() }
  }

  $entriesOffset = 6
  $payloadOffset = $entriesOffset + 16 * $sizes.Count
  $cursor = $payloadOffset
  foreach ($p in $payloads) {
    $w = if ($p.size -ge 256) { 0 } else { $p.size }
    $h = if ($p.size -ge 256) { 0 } else { $p.size }
    $bw.Write([Byte]$w)              # width  (0 = 256)
    $bw.Write([Byte]$h)              # height (0 = 256)
    $bw.Write([Byte]0)               # palette
    $bw.Write([Byte]0)               # reserved
    $bw.Write([UInt16]1)             # color planes
    $bw.Write([UInt16]32)            # bit depth
    $bw.Write([UInt32]$p.bytes.Length)
    $bw.Write([UInt32]$cursor)
    $cursor += $p.bytes.Length
  }
  foreach ($p in $payloads) { $bw.Write($p.bytes) }

  [System.IO.File]::WriteAllBytes($IcoPath, $ms.ToArray())
  $src.Dispose()
}

# ---- Generate ICO (required) ----------------------------------------------
try {
  New-IconFromPng -Png $SourceAbs -IcoPath $OutAbs
  Write-Host "[ok] $OutAbs" -ForegroundColor Green
} catch {
  Write-Host "[FATAL] ICO generation failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 2
}

# ---- Generate Inno Setup banner BMPs (optional) ---------------------------
# Wrapped in try/catch so a GDI+ generic-error on Save does not block
# the rest of the build pipeline. ICO success is the gate; BMPs are nice-to-have.
function New-BmpFromPng {
  param([string]$Png, [string]$BmpPath, [int]$W, [int]$H)
  $src = [System.Drawing.Image]::FromFile($Png)
  $bmp = $null
  $g   = $null
  try {
    # Force 24bpp RGB to avoid GDI+ generic errors saving BMPs with alpha.
    $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::White)
    $aspect = [Math]::Min(($W * 0.7) / $src.Width, ($H * 0.7) / $src.Height)
    $w2 = [int]($src.Width * $aspect)
    $h2 = [int]($src.Height * $aspect)
    $x  = [int](($W - $w2) / 2)
    $y  = [int](($H - $h2) / 2)
    $g.DrawImage($src, $x, $y, $w2, $h2)
    $g.Dispose(); $g = $null

    # Save to .NET FileStream so we control file open/close explicitly,
    # bypassing some GDI+ idiosyncrasies with paths.
    $fs = [System.IO.File]::Open($BmpPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    try {
      $bmp.Save($fs, [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
      $fs.Close()
    }
    Write-Host "[ok] $BmpPath" -ForegroundColor Green
  } catch {
    Write-Host "[warn] BMP generation skipped ($BmpPath): $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "       (Inno Setup banner is optional; the .ico file is the required output.)" -ForegroundColor Yellow
  } finally {
    if ($g)   { $g.Dispose() }
    if ($bmp) { $bmp.Dispose() }
    $src.Dispose()
  }
}

$bannerOut = Join-Path $OutDirAbs 'telehubx-banner.bmp'
$smallOut  = Join-Path $OutDirAbs 'telehubx-banner-small.bmp'
New-BmpFromPng -Png $SourceAbs -BmpPath $bannerOut -W 164 -H 314
New-BmpFromPng -Png $SourceAbs -BmpPath $smallOut  -W 55  -H 58

exit 0
