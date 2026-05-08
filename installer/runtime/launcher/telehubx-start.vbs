' TeleHubX silent launcher (Issue #14 vmfix8)
' Runs telehubx-supervisor.exe hidden so customer doesn't see a console window.
' Shortcut should target: wscript.exe "<install>\tools\telehubx-start.vbs"
Option Explicit
Dim WshShell, fso, scriptDir, exe
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = scriptDir & "\telehubx-supervisor.exe"
If Not fso.FileExists(exe) Then
  WScript.Echo "telehubx-supervisor.exe not found at " & exe
  WScript.Quit 1
End If
' Run hidden (0), do not wait (False).
WshShell.Run """" & exe & """", 0, False
