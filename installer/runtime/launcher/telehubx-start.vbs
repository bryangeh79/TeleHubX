' TeleHubX Start (vmfix20 / Issue #28)
'
' 1) Tells SCM to start the TeleHubX service
'    - sc.exe is idempotent: starting an already-running service returns
'      exit code 1056 ("service already started"), which is treated as OK
'    - Other non-zero codes are surfaced via MsgBox so the operator knows
'      something went wrong instead of silently watching the splash time out
' 2) Spawns telehubx-loading.hta for visible progress feedback
'
' Per vmfix20 the service is now Automatic startmode, so this shortcut is
' mostly used after a manual Stop or for troubleshooting. Daily users open
' "TeleHubX Dashboard" instead.
Option Explicit
On Error Resume Next

Dim shell, scriptDir, htaPath, scExitCode
Set shell = CreateObject("WScript.Shell")

' 1) Start the service via SCM. Hidden, wait for sc to return.
scExitCode = shell.Run("sc.exe start TeleHubX", 0, True)

' Exit codes that mean "OK, service is now (or was already) running":
'   0    = started successfully
'   1056 = service already started (idempotent no-op)
If scExitCode <> 0 And scExitCode <> 1056 Then
  ' Decode common failures so the operator gets an actionable message.
  Dim msg
  Select Case scExitCode
    Case 5
      msg = "无权限启动 TeleHubX 服务（Access denied）。" & vbCrLf & vbCrLf & _
            "如果你刚刚装好 TeleHubX，重启电脑一次让 Auto-start 接管。" & vbCrLf & _
            "或者右键此快捷方式 → 以管理员身份运行。" & vbCrLf & vbCrLf & _
            "exit code: 5"
    Case 1060
      msg = "TeleHubX 服务未注册。" & vbCrLf & vbCrLf & _
            "请重新安装 TeleHubX。" & vbCrLf & vbCrLf & _
            "exit code: 1060"
    Case 1058
      msg = "TeleHubX 服务被禁用。" & vbCrLf & vbCrLf & _
            "请在「services.msc」里把启动类型改回「自动」。" & vbCrLf & vbCrLf & _
            "exit code: 1058"
    Case Else
      msg = "TeleHubX 服务启动失败。" & vbCrLf & vbCrLf & _
            "请打开桌面「TeleHubX Debug」快捷方式查看实时日志，" & vbCrLf & _
            "或检查 %ProgramData%\TeleHubX\data\logs\supervisor.log。" & vbCrLf & vbCrLf & _
            "sc.exe exit code: " & scExitCode
  End Select
  MsgBox msg, vbCritical, "TeleHubX 启动失败"
  WScript.Quit scExitCode
End If

' 2) Resolve sibling .hta path. This .vbs lives in {app}\tools\ next
'    to telehubx-loading.hta.
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
htaPath = scriptDir & "telehubx-loading.hta"

' 3) Spawn the loading window (visible, NOT waiting). mshta.exe is
'    built into Windows (since XP). The HTA owns its own lifetime,
'    polls /health, opens the browser when ready, then auto-closes.
shell.Run "mshta.exe """ & htaPath & """", 1, False

WScript.Quit 0
