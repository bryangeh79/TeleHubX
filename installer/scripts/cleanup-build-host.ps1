# cleanup-build-host.ps1
# Force-kills any TeleHubX supervisor / postgres / redis processes that were
# left behind by interrupted probe runs on the build host, then removes
# installer/dist/ and %APPDATA%\TeleHubX. Build-host only; never bundled.
$tgPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$victims = Get-Process postgres, redis-server, telehubx-supervisor, telehubx-stop -EA SilentlyContinue |
  Where-Object { $_.Path -and $_.Path -like "$tgPath\*" }
foreach ($p in $victims) {
  try { Stop-Process -Id $p.Id -Force -EA Stop; "killed $($p.Name) pid=$($p.Id)" }
  catch { "fail $($p.Name) $($p.Id): $($_.Exception.Message)" }
}
Start-Sleep -Seconds 3
$dist = Join-Path $tgPath 'installer\dist'
Remove-Item -Recurse -Force $dist -EA SilentlyContinue
if (Test-Path $dist) { cmd /c "rd /s /q `"$dist`"" | Out-Null }
"dist exists: $(Test-Path $dist)"
$appdata = Join-Path $env:APPDATA 'TeleHubX'
Remove-Item -Recurse -Force $appdata -EA SilentlyContinue
"appdata exists: $(Test-Path $appdata)"
