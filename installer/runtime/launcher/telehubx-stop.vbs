' TeleHubX Stop (Issue #19 service architecture)
' Tells SCM to stop the TeleHubX service. SCM signals supervisor, which kills
' its children in order. Stop tool's 6-step PID validation still applies if
' any orphan child survives (unlikely with detached:false + supervisor as
' parent in service session 0).
Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
' Hidden window, wait until sc returns. SCM enforces graceful 30s timeout
' (configured in telehubx-service.xml stoptimeout).
shell.Run "sc.exe stop TeleHubX", 0, True

' After SCM reports stopped, run our orphan-cleanup stop tool to catch any
' detached child that escaped service-managed teardown (rare). 6-step PID
' safety still gates every kill — no broad kill possible.
shell.Run """%ProgramFiles%\TeleHubX\tools\telehubx-stop.exe""", 0, True

WScript.Quit 0
