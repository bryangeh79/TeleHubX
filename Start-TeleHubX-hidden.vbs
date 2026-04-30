' ============================================================
' TeleHubX silent background launcher
' Called by the [TeleHubX] desktop shortcut for a no-console start.
' Opens browser once backend is ready; writes a log for debugging.
' ============================================================

Dim objShell, strProj, strBat, strLog

strProj = "C:\AI_WORKSPACE\Telegram Auto Bot"
strBat  = strProj & "\Start-TeleHubX.bat"
strLog  = strProj & "\logs\launcher.log"

Set objShell = CreateObject("WScript.Shell")

' Check that the bat exists
Dim objFSO
Set objFSO = CreateObject("Scripting.FileSystemObject")
If Not objFSO.FileExists(strBat) Then
    MsgBox "TeleHubX launcher not found:" & vbCrLf & strBat, 16, "TeleHubX"
    WScript.Quit 1
End If

' Ensure logs\ directory exists
If Not objFSO.FolderExists(strProj & "\logs") Then
    objFSO.CreateFolder(strProj & "\logs")
End If

' Run bat hidden (0 = no window), wait = False
objShell.Run "cmd /c """ & strBat & """ >> """ & strLog & """ 2>&1", 0, False

' Show a brief tray-style notification
MsgBox "TeleHubX is starting..." & vbCrLf & "Dashboard will open at http://localhost:9601 when ready.", _
       64, "TeleHubX"

Set objShell = Nothing
Set objFSO   = Nothing
