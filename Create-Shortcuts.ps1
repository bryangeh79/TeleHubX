# ============================================================
# Create-Shortcuts.ps1
# Creates two desktop shortcuts for TeleHubX:
#   [TeleHubX]       - double-click to start (via VBS, no console flash)
#   [Stop TeleHubX]  - double-click to stop
# Run once after first install or if shortcuts are missing.
# ============================================================

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [System.Environment]::GetFolderPath('Desktop')
$wsh     = New-Object -ComObject WScript.Shell

function New-Shortcut {
    # NOTE: do NOT name a parameter "$Args" — that's an automatic variable
    # in PowerShell function scope (collects unbound positional args) and
    # will silently shadow / never get bound. Use $ArgList instead.
    param(
        [string]$Name,
        [string]$Target,
        [string]$ArgList = '',
        [string]$WorkDir = $root,
        [string]$Desc = ''
    )
    $lnk = $wsh.CreateShortcut("$desktop\$Name.lnk")
    $lnk.TargetPath       = $Target
    if ($ArgList) { $lnk.Arguments        = $ArgList }
    if ($WorkDir) { $lnk.WorkingDirectory = $WorkDir }
    if ($Desc)    { $lnk.Description      = $Desc }
    $lnk.Save()
    Write-Host "  Created: $desktop\$Name.lnk" -ForegroundColor Green
}

Write-Host ""
Write-Host "Creating TeleHubX desktop shortcuts..." -ForegroundColor Cyan
Write-Host ""

# [TeleHubX] - silent launcher via VBS
New-Shortcut `
    -Name    "TeleHubX" `
    -Target  "wscript.exe" `
    -ArgList "`"$root\Start-TeleHubX-hidden.vbs`"" `
    -Desc    "Start TeleHubX (backend + dashboard + agent)"

# [Stop TeleHubX] - stopper
New-Shortcut `
    -Name    "Stop TeleHubX" `
    -Target  "$root\Stop-TeleHubX.bat" `
    -Desc    "Stop TeleHubX services"

Write-Host ""
Write-Host "Done. You can now double-click 'TeleHubX' on your desktop." -ForegroundColor Green
Write-Host ""
