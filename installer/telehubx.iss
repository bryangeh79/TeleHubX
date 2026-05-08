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
OutputBaseFilename=TeleHubX-Setup-{#AppVersion}-vmfix7
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
Name: "{userappdata}\TeleHubX\data";        Permissions: users-modify
Name: "{userappdata}\TeleHubX\data\run";    Permissions: users-modify
Name: "{userappdata}\TeleHubX\data\logs";   Permissions: users-modify
Name: "{userappdata}\TeleHubX\data\sessions"; Permissions: users-modify
Name: "{userappdata}\TeleHubX\data\uploads";  Permissions: users-modify
Name: "{userappdata}\TeleHubX\data\pgdata";   Permissions: users-modify
Name: "{userappdata}\TeleHubX\data\redis";  Permissions: users-modify

[Icons]
; Desktop shortcuts (using TeleHubX logo)
Name: "{commondesktop}\Start TeleHubX";  Filename: "{app}\tools\{#AppExeName}";  IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon; Comment: "Start TeleHubX"
Name: "{commondesktop}\Stop TeleHubX";   Filename: "{app}\tools\{#StopExeName}"; IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon; Comment: "Stop TeleHubX"

; Start menu group
Name: "{group}\Start TeleHubX";          Filename: "{app}\tools\{#AppExeName}";  IconFilename: "{app}\assets\telehubx.ico"
Name: "{group}\Stop TeleHubX";           Filename: "{app}\tools\{#StopExeName}"; IconFilename: "{app}\assets\telehubx.ico"
Name: "{group}\Uninstall TeleHubX";      Filename: "{uninstallexe}"

[Run]
; First-run env init: copy .env.template to %APPDATA%\TeleHubX\.env if absent
Filename: "{cmd}"; Parameters: "/C if not exist ""{userappdata}\TeleHubX\.env"" copy /Y ""{app}\.env.template"" ""{userappdata}\TeleHubX\.env"" >nul"; Flags: runhidden waituntilterminated

; Optional: set up logon-triggered scheduled task for auto-start
Filename: "schtasks"; Parameters: "/Create /TN ""TeleHubX Autostart"" /TR ""\""{app}\tools\{#AppExeName}\"""" /SC ONLOGON /RL HIGHEST /F"; Flags: runhidden waituntilterminated; Tasks: autostart

; Offer to start TeleHubX immediately after install completes
Filename: "{app}\tools\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Always try a clean stop first (before files vanish)
Filename: "{app}\tools\{#StopExeName}"; Flags: runhidden waituntilterminated; RunOnceId: "StopBeforeUninstall"
; Remove autostart task (if it exists; ignore failure)
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
    '   ' + ExpandConstant('{userappdata}') + '\TeleHubX'#13#10#13#10 +
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
    DataPath := ExpandConstant('{userappdata}\TeleHubX');
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
