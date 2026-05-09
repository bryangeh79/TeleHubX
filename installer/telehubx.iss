; TeleHubX Inno Setup script (Phase 4)
; ISCC.exe installer\telehubx.iss

#define AppName       "TeleHubX"
#define AppVersion    "1.0.0"
#define AppPublisher  "Starbright Solutions"
#define AppURL        "https://telehubx-license.starbright-solutions.com"
#define AppExeName    "telehubx-supervisor.exe"
#define StopExeName   "telehubx-stop.exe"

[Setup]
AppId={{A4F19E2D-7B22-4FB8-9E0B-93F4B1C7C2A1}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
LicenseFile=
OutputBaseFilename=TeleHubX-Setup-{#AppVersion}-vmfix19
OutputDir=Output
SetupIconFile=assets\telehubx.ico
WizardImageFile=assets\telehubx-banner.bmp
WizardSmallImageFile=assets\telehubx-banner-small.bmp
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern
UninstallDisplayIcon={app}\assets\telehubx.ico
UninstallDisplayName={#AppName} {#AppVersion}
DisableWelcomePage=no
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english";  MessagesFile: "compiler:Default.isl"
Name: "chinese";  MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "autostart";   Description: "Start TeleHubX automatically when Windows logs in"; GroupDescription: "Other:"; Flags: unchecked

[Files]
; Application code (built dist)
Source: "dist\apps\*";       DestDir: "{app}\apps";       Flags: recursesubdirs ignoreversion
; Tools (.exe — Node SEA bundles)
Source: "dist\tools\*";     DestDir: "{app}\tools";     Flags: recursesubdirs ignoreversion
; Runtime binaries (Node + Postgres + Memurai)
Source: "dist\runtime\*";   DestDir: "{app}\runtime";   Flags: recursesubdirs ignoreversion
; Assets (logo for shortcuts + uninstaller)
Source: "assets\telehubx.ico"; DestDir: "{app}\assets"; Flags: ignoreversion
; .env template (no secrets) — copied at first run if user .env doesn't exist
Source: "dist\.env";        DestDir: "{app}";           DestName: ".env.template"; Flags: ignoreversion
; vmfix14 (Issue #21): VERSION.txt for installer-version verification gate
Source: "dist\VERSION.txt"; DestDir: "{app}";           Flags: ignoreversion

[Dirs]
; Ensure data dir exists for current user
Name: "{commonappdata}\TeleHubX\data";        Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\run";    Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\logs";   Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\sessions"; Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\uploads";  Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\pgdata";   Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\redis-data";  Permissions: users-modify

[Icons]
; Desktop shortcuts (using TeleHubX logo)
; Issue #19: shortcuts call sc.exe via VBS (hidden) for service-managed lifecycle.
; Start.vbs: sc start TeleHubX -> wait /health -> open browser
; Stop.vbs: sc stop TeleHubX
; Debug.vbs: visible PowerShell tailing supervisor.log + status
Name: "{commondesktop}\Start TeleHubX";  Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-start.vbs"""; WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon; Comment: "Start TeleHubX (manages Windows service)"
Name: "{commondesktop}\Stop TeleHubX";   Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-stop.vbs""";  WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon; Comment: "Stop TeleHubX (stops Windows service)"

; Start menu group
Name: "{group}\Start TeleHubX";          Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-start.vbs"""; WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"
Name: "{group}\Stop TeleHubX";           Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-stop.vbs""";  WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"
Name: "{group}\TeleHubX Debug";          Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-debug.vbs"""; WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Comment: "Show service status + tail logs"
Name: "{group}\Uninstall TeleHubX";      Filename: "{uninstallexe}"

[Run]
; Issue #19: first-run env init at %ProgramData%\TeleHubX (machine-wide)
Filename: "{cmd}"; Parameters: "/C if not exist ""{commonappdata}\TeleHubX\.env"" copy /Y ""{app}\.env.template"" ""{commonappdata}\TeleHubX\.env"" >nul"; Flags: runhidden waituntilterminated

; Issue #19: register the Windows Service via WinSW. After install,
; service appears in services.msc as "TeleHubX". Start mode = Manual.
; Issue #20: service identity = NT AUTHORITY\LocalService (non-admin) so
;            postgres.exe doesn't refuse with admin-user error.
Filename: "{app}\tools\telehubx-service.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Installing TeleHubX Windows Service..."

; Issue #20: grant LocalService write access to data dir + read+execute to runtime.
; LocalService is NOT in the Users group, so default ProgramData ACL doesn't
; include it. We use icacls to grant explicitly. (OI)(CI) makes the grant
; inherit to subdirectories and files. /T applies recursively.
Filename: "icacls"; Parameters: """{commonappdata}\TeleHubX"" /grant ""NT AUTHORITY\LocalService:(OI)(CI)F"" /T /Q"; Flags: runhidden waituntilterminated; StatusMsg: "Granting service account access to data directory..."
Filename: "icacls"; Parameters: """{app}\runtime"" /grant ""NT AUTHORITY\LocalService:(OI)(CI)RX"" /T /Q"; Flags: runhidden waituntilterminated; StatusMsg: "Granting service account access to runtime..."
Filename: "icacls"; Parameters: """{app}\apps"" /grant ""NT AUTHORITY\LocalService:(OI)(CI)RX"" /T /Q"; Flags: runhidden waituntilterminated; StatusMsg: "Granting service account access to apps..."

; Optional auto-start on user logon (Tasks: autostart). schtasks runs the
; Start VBS, which calls sc start. Disabled by default per Bryan's decision.
Filename: "schtasks"; Parameters: "/Create /TN ""TeleHubX Autostart"" /TR ""wscript.exe \""{app}\tools\telehubx-start.vbs\"""" /SC ONLOGON /RL HIGHEST /F"; Flags: runhidden waituntilterminated; Tasks: autostart

; Offer to start TeleHubX immediately after install
Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-start.vbs"""; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Issue #19: stop + unregister the Windows Service before files vanish
Filename: "{app}\tools\telehubx-service.exe"; Parameters: "stop";      Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{app}\tools\telehubx-service.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallService"
; Belt-and-suspenders orphan cleanup (6-step PID safety still gates every kill)
Filename: "{app}\tools\{#StopExeName}"; Flags: runhidden waituntilterminated; RunOnceId: "OrphanCleanup"
; Remove autostart task (ignore if absent)
Filename: "schtasks"; Parameters: "/Delete /TN ""TeleHubX Autostart"" /F"; Flags: runhidden waituntilterminated skipifdoesntexist; RunOnceId: "RemoveAutostart"

[UninstallDelete]
Type: dirifempty; Name: "{app}"

[Code]
var
  DataDeletePage: TInputOptionWizardPage;

// vmfix14 (Issue #21): aggressively remove any pre-existing TeleHubX service
// before file replacement so the new install isn't a no-op merge with the old
// service registration. Bryan's vmfix13 install showed StartName still as
// LocalSystem because the old service registration survived.
function RemoveExistingService(): Boolean;
var
  ResultCode: Integer;
begin
  // Stop first (ignore errors — service may not exist or already stopped)
  Exec(ExpandConstant('{cmd}'), '/c sc.exe stop TeleHubX', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
  Sleep(2000);
  // Try WinSW uninstall first if present (graceful)
  if FileExists(ExpandConstant('{app}\tools\telehubx-service.exe')) then begin
    Exec(ExpandConstant('{app}\tools\telehubx-service.exe'), 'uninstall', '',
         SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(1000);
  end;
  // Authoritative deletion via SCM (works even if WinSW exe is gone)
  Exec(ExpandConstant('{cmd}'), '/c sc.exe delete TeleHubX', '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
  Sleep(1500);
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  RemoveExistingService();
  Result := '';
end;

// vmfix14 (Issue #21): after WinSW install, FORCE service identity to
// LocalService via sc.exe — WinSW v2 <serviceaccount> XML doesn't always
// apply for built-in accounts on all Windows versions. sc config is
// authoritative regardless. Then verify with sc qc and fail loudly if the
// fix didn't take effect (otherwise PostgreSQL will refuse to start).
procedure ApplyAndVerifyServiceAccount();
var
  ResultCode: Integer;
  Output: AnsiString;
  TmpFile: String;
  OutputStr: String;
begin
  // Step 1: force StartName via sc config
  Exec(ExpandConstant('{cmd}'),
       '/c sc.exe config TeleHubX obj= "NT AUTHORITY\LocalService"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ResultCode <> 0 then begin
    MsgBox(
      'WARNING: sc config returned exit code ' + IntToStr(ResultCode) + '.' #13#10 +
      'TeleHubX service may still run as LocalSystem. PostgreSQL will refuse ' +
      'to start. Please report this to TeleHubX support.',
      mbError, MB_OK);
  end;

  // Step 2: verify via sc qc
  TmpFile := ExpandConstant('{tmp}\sc-qc-telehubx.txt');
  Exec(ExpandConstant('{cmd}'),
       '/c sc.exe qc TeleHubX > "' + TmpFile + '" 2>&1',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if LoadStringFromFile(TmpFile, Output) then begin
    OutputStr := String(Output);
    if Pos('NT AUTHORITY\LocalService', OutputStr) > 0 then begin
      // OK — service is correctly configured
    end else begin
      MsgBox(
        'CRITICAL: TeleHubX service identity is NOT LocalService.' #13#10 +
        'PostgreSQL will refuse to start under the current identity.' #13#10#13#10 +
        'sc qc TeleHubX output:' #13#10 + OutputStr,
        mbError, MB_OK);
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    ApplyAndVerifyServiceAccount();
  end;
end;

procedure InitializeWizard;
begin
  DataDeletePage := CreateInputOptionPage(wpSelectTasks,
    'Data folder',
    'How should TeleHubX data be handled on uninstall?',
    'TeleHubX stores license, account sessions, knowledge base files and historical leads in:'#13#10 +
    '   ' + ExpandConstant('{commonappdata}') + '\TeleHubX'#13#10#13#10 +
    'On uninstall, do you want to keep this folder for a future re-install?',
    True, False);
  DataDeletePage.Add('Keep data folder (recommended — safe to re-install later)');
  DataDeletePage.Add('Delete data folder permanently (CANNOT be undone)');
  DataDeletePage.SelectedValueIndex := 0;
end;

function ShouldDeleteData(): Boolean;
begin
  Result := (DataDeletePage <> nil) and (DataDeletePage.SelectedValueIndex = 1);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataPath: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataPath := ExpandConstant('{commonappdata}\TeleHubX');
    if DirExists(DataPath) then
    begin
      // We don't have access to the install-time DataDeletePage choice here, so always
      // ask one more time at uninstall — Inno Setup limitation.
      if MsgBox(
           'Delete TeleHubX data folder?'#13#10#13#10 +
           DataPath + #13#10#13#10 +
           'This includes license activation, account sessions, knowledge base files, ' +
           'leads history and Postgres data.'#13#10#13#10 +
           'Click YES to delete (cannot be undone).'#13#10 +
           'Click NO to keep (recommended — safe to re-install later).',
           mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      begin
        DelTree(DataPath, True, True, True);
      end;
    end;
  end;
end;
