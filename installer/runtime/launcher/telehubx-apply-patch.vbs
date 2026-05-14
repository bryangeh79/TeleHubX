' telehubx-apply-patch.vbs — desktop shortcut launcher for Tier 2 patch
'
' Behavior:
'   1. Prompt user to select a TeleHubX-Patch-*.zip file
'   2. Re-launch self elevated (UAC prompt) running PowerShell with Apply-Patch.ps1
'   3. PowerShell window stays open so user sees progress + result
'
' This file is staged into C:\Program Files\TeleHubX\tools\ by the installer.

Option Explicit

Dim shell, fso, scriptDir, psScript
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psScript  = scriptDir & "\Apply-Patch.ps1"

If Not fso.FileExists(psScript) Then
  MsgBox "Apply-Patch.ps1 not found at:" & vbCrLf & psScript & vbCrLf & vbCrLf & _
         "Re-install TeleHubX to repair.", vbCritical, "TeleHubX Apply Patch"
  WScript.Quit 1
End If

' Use Windows file picker via PowerShell (cleanest approach)
Dim pickCmd, pickProc
pickCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command """ & _
  "Add-Type -AssemblyName System.Windows.Forms; " & _
  "$d = New-Object System.Windows.Forms.OpenFileDialog; " & _
  "$d.Filter = 'TeleHubX patch (*.zip)|TeleHubX-Patch-*.zip|All zip (*.zip)|*.zip'; " & _
  "$d.Title  = 'Select TeleHubX patch zip'; " & _
  "if ($d.ShowDialog() -eq 'OK') { Write-Host $d.FileName }"""

Dim exec, picked
Set exec = shell.Exec(pickCmd)
Do While Not exec.StdOut.AtEndOfStream
  picked = exec.StdOut.ReadLine
Loop
exec.StdOut.Close

If Len(picked) = 0 Then
  ' user cancelled
  WScript.Quit 0
End If

If Not fso.FileExists(picked) Then
  MsgBox "Selected file not found:" & vbCrLf & picked, vbCritical, "TeleHubX Apply Patch"
  WScript.Quit 1
End If

' Confirm with user before elevating
Dim confirm
confirm = MsgBox( _
  "Apply this TeleHubX patch?" & vbCrLf & vbCrLf & _
  picked & vbCrLf & vbCrLf & _
  "This will:" & vbCrLf & _
  "  1. Stop TeleHubX service (~10 sec downtime starting now)" & vbCrLf & _
  "  2. Back up current installation" & vbCrLf & _
  "  3. Apply the patch" & vbCrLf & _
  "  4. Restart service" & vbCrLf & _
  "  5. Auto-rollback if anything fails" & vbCrLf & vbCrLf & _
  "Continue?", _
  vbYesNo + vbQuestion, "TeleHubX Apply Patch")

If confirm <> vbYes Then WScript.Quit 0

' Launch PowerShell ELEVATED with the patch script
Dim psArgs, runas
psArgs = "-NoExit -ExecutionPolicy Bypass -File """ & psScript & """ -PatchZip """ & picked & """ -Yes"
Set runas = CreateObject("Shell.Application")
runas.ShellExecute "powershell.exe", psArgs, scriptDir, "runas", 1
