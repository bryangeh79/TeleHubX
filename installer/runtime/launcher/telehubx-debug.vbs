' TeleHubX Debug (Issue #19 — for Bryan/CC visible diagnostics)
' Opens a PowerShell window tailing supervisor.log + service status.
Option Explicit
Dim shell, cmd
Set shell = CreateObject("WScript.Shell")

cmd = "powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -Command " & _
      """Write-Host '=== TeleHubX Debug ===' -ForegroundColor Cyan; " & _
      "Write-Host 'service status:' -ForegroundColor Yellow; " & _
      "sc.exe query TeleHubX; " & _
      "Write-Host '`nport listeners:' -ForegroundColor Yellow; " & _
      "Get-NetTCPConnection -LocalPort 5436,6386,9800,9601 -State Listen -EA 0 | Format-Table LocalPort,State,OwningProcess; " & _
      "Write-Host '`npid files:' -ForegroundColor Yellow; " & _
      "Get-ChildItem $env:ProgramData\TeleHubX\data\run\*.pid -EA 0 | Select-Object Name, Length; " & _
      "Write-Host '`ntailing supervisor.log (Ctrl+C to exit):' -ForegroundColor Yellow; " & _
      "Get-Content $env:ProgramData\TeleHubX\data\logs\supervisor.log -Wait -Tail 50"""

' Visible window (1 = SW_SHOWNORMAL), don't wait.
shell.Run cmd, 1, False
WScript.Quit 0
