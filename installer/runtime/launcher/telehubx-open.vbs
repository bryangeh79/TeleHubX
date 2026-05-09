' TeleHubX Dashboard (vmfix20 / Issue #28)
'
' Pure dashboard-open shortcut. Does NOT touch the service — assumes the
' service is already running (Auto-start brings it up on Windows boot).
'
' Use cases:
'   - Operator accidentally closed the browser window
'   - Operator wants to open dashboard in a different browser tab
'   - Daily driver entry point (Auto-start handles service lifecycle)
'
' If the service is genuinely stopped, the browser will show a connection
' error and the operator knows to click "Start TeleHubX" instead.
Option Explicit
On Error Resume Next

CreateObject("WScript.Shell").Run _
  "rundll32.exe url.dll,FileProtocolHandler http://127.0.0.1:9601/", _
  1, False

WScript.Quit 0
