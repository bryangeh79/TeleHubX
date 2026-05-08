' TeleHubX Start (vmfix18 / Issue #25)
'
' 1) Tells SCM to start the TeleHubX service
' 2) Spawns telehubx-loading.hta (visible loading window) which itself:
'    - polls /health for up to 5 min
'    - shows progress text so the operator sees "things are happening"
'    - opens the dashboard URL in the default browser when /health 200
'    - closes itself
'
' Splitting the polling/UX into the HTA frees this .vbs from having to
' know about timing or browser-open. .vbs only does service-start.
Option Explicit
On Error Resume Next

Dim shell, scriptDir, htaPath
Set shell = CreateObject("WScript.Shell")

' 1) Start the service via SCM. Hidden, wait for sc to return.
'    sc.exe is idempotent: starting an already-running service is a
'    safe no-op (returns "service already started" exit code 1056).
shell.Run "sc.exe start TeleHubX", 0, True

' 2) Resolve sibling .hta path. This .vbs lives in {app}\tools\ next
'    to telehubx-loading.hta.
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
htaPath = scriptDir & "telehubx-loading.hta"

' 3) Spawn the loading window (visible, NOT waiting). mshta.exe is
'    built into Windows (since XP). The HTA owns its own lifetime.
shell.Run "mshta.exe """ & htaPath & """", 1, False

WScript.Quit 0
