' TeleHubX Start (Issue #19 service architecture)
' Tells SCM to start the TeleHubX service, waits until /health responds,
' then opens browser to /settings/license. All hidden — runs in user session.
Option Explicit
On Error Resume Next

Dim shell, http, i, healthOk
Set shell = CreateObject("WScript.Shell")

' 1) Start the service via SCM. Hidden window, wait until sc returns.
shell.Run "sc.exe start TeleHubX", 0, True

' If the service failed to start (e.g. not installed), notify and bail.
Dim startCheck
startCheck = shell.Run("sc.exe query TeleHubX", 0, True)
If Err.Number <> 0 Then
  MsgBox "TeleHubX service is not installed. Please re-run the installer.", vbCritical, "TeleHubX"
  WScript.Quit 1
End If
On Error Goto 0

' 2) Poll /health up to 90 seconds.
Set http = CreateObject("MSXML2.XMLHTTP.6.0")
healthOk = False
For i = 1 To 90
  WScript.Sleep 1000
  On Error Resume Next
  http.Open "GET", "http://127.0.0.1:9800/health", False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then
    healthOk = True
    Exit For
  End If
  Err.Clear
  On Error Goto 0
Next

' 3) Open browser regardless — license page works even if /health probe
'    happened to time out (dashboard reverse-proxies to server eventually).
shell.Run "rundll32.exe url.dll,FileProtocolHandler http://127.0.0.1:9601/settings/license", 0, False

' 4) If health never came up, surface a friendly hint instead of silent fail.
If Not healthOk Then
  shell.Run "rundll32.exe url.dll,FileProtocolHandler file:///" & _
    Replace(shell.ExpandEnvironmentStrings("%ProgramData%\TeleHubX\data\logs\supervisor.log"), "\", "/"), 0, False
End If

WScript.Quit 0
