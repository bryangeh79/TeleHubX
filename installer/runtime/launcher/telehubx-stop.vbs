' TeleHubX silent stop launcher (Issue #14 vmfix8)
Option Explicit
Dim WshShell, fso, scriptDir, exe
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = scriptDir & "\telehubx-stop.exe"
If Not fso.FileExists(exe) Then
  WScript.Echo "telehubx-stop.exe not found at " & exe
  WScript.Quit 1
End If
' Run hidden (0), wait for completion (True) so user knows when it's done.
WshShell.Run """" & exe & """", 0, True
