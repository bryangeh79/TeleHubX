# png-to-ico.ps1 — Logo PNG → 多尺寸 .ico (256/128/64/48/32/16)
#
# 用法:
#   .\installer\scripts\png-to-ico.ps1 -Source installer\assets\telehubx-logo.png `
#                                       -Out    installer\assets\telehubx.ico
#
# 同时生成 Inno Setup 用的 BMP banner:
#   .\installer\scripts\png-to-ico.ps1 -BannerSource ... -BannerOut ...
#
# 仅依赖 .NET / GDI+ (PowerShell 内置, 无外部工具)

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Out
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) { throw "Source PNG not found: $Source" }
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out)

Add-Type -AssemblyName System.Drawing

function New-IconFromPng {
  param([string]$Png, [string]$IcoPath)

  $sizes = 256, 128, 64, 48, 32, 16
  $src = [System.Drawing.Image]::FromFile((Resolve-Path $Png))

  # 多尺寸 ICO 格式: header (6 bytes) + N entries (16 bytes each) + N PNG payloads
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)

  # ICONDIR header
  $bw.Write([UInt16]0)               # reserved
  $bw.Write([UInt16]1)               # type=icon
  $bw.Write([UInt16]$sizes.Count)    # # of images

  # Resize all sizes to PNG memory streams first
  $payloads = @()
  foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()
    $pngStream = New-Object System.IO.MemoryStream
    $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $payloads += ,@{ size = $s; bytes = $pngStream.ToArray() }
  }

  # ICONDIRENTRY entries (16 bytes each), then payloads concatenated
  $entriesOffset = 6
  $payloadOffset = $entriesOffset + 16 * $sizes.Count
  $cursor = $payloadOffset
  foreach ($p in $payloads) {
    $w = if ($p.size -ge 256) { 0 } else { $p.size }
    $h = if ($p.size -ge 256) { 0 } else { $p.size }
    $bw.Write([Byte]$w)              # width (0 = 256)
    $bw.Write([Byte]$h)              # height
    $bw.Write([Byte]0)               # palette
    $bw.Write([Byte]0)               # reserved
    $bw.Write([UInt16]1)             # color planes
    $bw.Write([UInt16]32)            # bit depth
    $bw.Write([UInt32]$p.bytes.Length)
    $bw.Write([UInt32]$cursor)
    $cursor += $p.bytes.Length
  }
  foreach ($p in $payloads) {
    $bw.Write($p.bytes)
  }

  [System.IO.File]::WriteAllBytes((Resolve-Path -LiteralPath (Split-Path $IcoPath)).Path + '\' + (Split-Path -Leaf $IcoPath), $ms.ToArray())
  $src.Dispose()
}

New-IconFromPng -Png $Source -IcoPath $Out
Write-Host "[ok] $Out" -ForegroundColor Green

# Inno Setup BMP assets (164x314 banner, 55x58 small) ─ optional, only if present
function New-BmpFromPng {
  param([string]$Png, [string]$BmpPath, [int]$W, [int]$H)
  if (-not (Test-Path $Png)) { return }
  $src = [System.Drawing.Image]::FromFile((Resolve-Path $Png))
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::White)
  # center the logo
  $aspect = [Math]::Min($W * 0.7 / $src.Width, $H * 0.7 / $src.Height)
  $w2 = [int]($src.Width * $aspect)
  $h2 = [int]($src.Height * $aspect)
  $x = ($W - $w2) / 2
  $y = ($H - $h2) / 2
  $g.DrawImage($src, $x, $y, $w2, $h2)
  $g.Dispose()
  $bmp.Save($BmpPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose(); $src.Dispose()
  Write-Host "[ok] $BmpPath" -ForegroundColor Green
}

$bannerOut  = Join-Path (Split-Path -Parent $Out) 'telehubx-banner.bmp'
$smallOut   = Join-Path (Split-Path -Parent $Out) 'telehubx-banner-small.bmp'
New-BmpFromPng -Png $Source -BmpPath $bannerOut -W 164 -H 314
New-BmpFromPng -Png $Source -BmpPath $smallOut  -W 55  -H 58
