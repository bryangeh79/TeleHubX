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
OutputBaseFilename=TeleHubX-Setup-{#AppVersion}-vmfix12
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
; service appears in services.msc as "TeleHubX". Start mode = Manual
; per Bryan's decision (telehubx-service.xml startmode=Manual).
Filename: "{app}\tools\telehubx-service.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Installing TeleHubX Windows Service..."

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
