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
OutputBaseFilename=TeleHubX-Setup-{#AppVersion}-vmfix29_1
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

; vmfix22 (Issue #30): bundled SeedPack content (97 images + 200 voices +
; 25 videos + 80 chat scripts). Lands directly in the runtime data dir
; under %ProgramData%\TeleHubX\data. AssetsService.onModuleInit and
; ChatScriptsService.onModuleInit scan these on first server start and
; register everything in DB. NO sc stop/start race — service starts ONCE
; with all content already on disk.
Source: "seedpack\staging\assets\_builtin\*"; DestDir: "{commonappdata}\TeleHubX\data\assets\_builtin"; Flags: recursesubdirs ignoreversion createallsubdirs
Source: "seedpack\staging\script-packs\*";    DestDir: "{commonappdata}\TeleHubX\data\script-packs";   Flags: recursesubdirs ignoreversion createallsubdirs

[Dirs]
; Ensure data dir exists for current user
Name: "{commonappdata}\TeleHubX\data";        Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\run";    Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\logs";   Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\sessions"; Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\uploads";  Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\pgdata";   Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\redis-data";  Permissions: users-modify
; vmfix22: SeedPack target directories (created so even if seedpack
; staging is empty during a dev build, these paths exist for the
; onModuleInit scanners to log "directory present, 0 files" cleanly).
Name: "{commonappdata}\TeleHubX\data\assets\_builtin"; Permissions: users-modify
Name: "{commonappdata}\TeleHubX\data\script-packs";    Permissions: users-modify

[Icons]
; Desktop shortcuts (using TeleHubX logo)
; Issue #19: shortcuts call sc.exe via VBS (hidden) for service-managed lifecycle.
; Start.vbs:    sc start TeleHubX -> wait /health -> open browser
; Stop.vbs:     sc stop TeleHubX
; Debug.vbs:    visible PowerShell tailing supervisor.log + status
; Open.vbs:     vmfix20 — dashboard-only shortcut: opens browser to /
;               (assumes service already running; for daily use after
;                Auto-start brings the service up on Windows boot)
Name: "{commondesktop}\TeleHubX Dashboard"; Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-open.vbs""";  WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon; Comment: "Open TeleHubX Dashboard in default browser"
Name: "{commondesktop}\Start TeleHubX";     Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-start.vbs"""; WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon; Comment: "Start TeleHubX (manages Windows service)"
Name: "{commondesktop}\Stop TeleHubX";      Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-stop.vbs""";  WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon; Comment: "Stop TeleHubX (stops Windows service)"

; Start menu group
Name: "{group}\TeleHubX Dashboard";       Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-open.vbs""";  WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Comment: "Open TeleHubX Dashboard in default browser"
Name: "{group}\Start TeleHubX";           Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-start.vbs"""; WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"
Name: "{group}\Stop TeleHubX";            Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-stop.vbs""";  WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"
Name: "{group}\TeleHubX Debug";           Filename: "wscript.exe"; Parameters: """{app}\tools\telehubx-debug.vbs"""; WorkingDir: "{app}\tools"; IconFilename: "{app}\assets\telehubx.ico"; Comment: "Show service status + tail logs"
Name: "{group}\Uninstall TeleHubX";       Filename: "{uninstallexe}"

[Run]
; Issue #19: first-run env init at %ProgramData%\TeleHubX (machine-wide)
Filename: "{cmd}"; Parameters: "/C if not exist ""{commonappdata}\TeleHubX\.env"" copy /Y ""{app}\.env.template"" ""{commonappdata}\TeleHubX\.env"" >nul"; Flags: runhidden waituntilterminated

; Issue #19: register the Windows Service via WinSW.
; Issue #20: identity = NT AUTHORITY\LocalService (non-admin) so postgres
;            doesn't refuse with admin-user error.
; vmfix20 (Issue #28): WinSW XML now sets startmode=Automatic so the service
;                      starts with Windows. (Previously Manual — required
;                      manual click of Start every Windows boot.)
Filename: "{app}\tools\telehubx-service.exe"; Parameters: "install"; Flags: runhidden waituntilterminated; StatusMsg: "Installing TeleHubX Windows Service..."

; vmfix20 (Issue #28): grant Authenticated Users SERVICE_START + SERVICE_STOP
; + SERVICE_QUERY_STATUS + SERVICE_USER_DEFINED_CONTROL on the TeleHubX
; service. Default SCM ACL only grants those rights to elevated tokens, so
; non-elevated wscript.exe (which is what the desktop Start/Stop shortcuts
; spawn) hit "OpenService FAILED 5: Access is denied".
;
; SDDL breakdown:
;   D:                                   = DACL begin
;   (A;;CCLCSWRPWPDTLOCRRC;;;SY)         = SYSTEM full
;   (A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA) = Administrators full
;   (A;;CCLCSWLOCRRC;;;IU)               = Interactive Users (legacy)
;   (A;;CCLCSWLOCRRC;;;SU)               = Service accounts
;   (A;;RPWPCR;;;AU)                     = Authenticated Users:
;                                            RP = SERVICE_START
;                                            WP = SERVICE_STOP
;                                            CR = SERVICE_USER_DEFINED_CONTROL
Filename: "{cmd}"; Parameters: "/C sc.exe sdset TeleHubX D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;RPWPCR;;;AU)"; Flags: runhidden waituntilterminated; StatusMsg: "Granting non-admin users service start/stop access..."

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
  // vmfix25 (Issue #33): collect Telegram API credentials at install time
  // so the service starts with TG_API_ID/HASH already populated. Eliminates
  // the post-install bind/init -> 503 -> modal -> service restart dance.
  TgApiPage: TInputQueryWizardPage;

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

// vmfix25 (Issue #33): line-replace KEY=value in a .env-style file. If the
// key exists, replace the line; otherwise append. Preserves all other lines
// and comments. Creates the file (and parent directory) if missing.
procedure WriteEnvField(EnvPath, Key, Value: String);
var
  Lines: TArrayOfString;
  i, n: Integer;
  Found: Boolean;
  Prefix, Dir: String;
begin
  Found := False;
  Prefix := Key + '=';
  Dir := ExtractFilePath(EnvPath);
  if (Dir <> '') and (not DirExists(Dir)) then
    ForceDirectories(Dir);

  if FileExists(EnvPath) then begin
    if not LoadStringsFromFile(EnvPath, Lines) then begin
      SetArrayLength(Lines, 0);
    end;
    for i := 0 to GetArrayLength(Lines) - 1 do begin
      if Pos(Prefix, Lines[i]) = 1 then begin
        Lines[i] := Prefix + Value;
        Found := True;
      end;
    end;
    if not Found then begin
      n := GetArrayLength(Lines);
      SetArrayLength(Lines, n + 1);
      Lines[n] := Prefix + Value;
    end;
  end else begin
    SetArrayLength(Lines, 1);
    Lines[0] := Prefix + Value;
  end;

  SaveStringsToFile(EnvPath, Lines, False);
end;

// vmfix25 (Issue #33): read the value of KEY=... from a .env file, or
// empty string if absent / file missing. Used to pre-populate the wizard
// page on reinstall so the user doesn't have to re-enter credentials.
function ReadEnvField(EnvPath, Key: String): String;
var
  Lines: TArrayOfString;
  i: Integer;
  Prefix: String;
begin
  Result := '';
  Prefix := Key + '=';
  if not FileExists(EnvPath) then Exit;
  if not LoadStringsFromFile(EnvPath, Lines) then Exit;
  for i := 0 to GetArrayLength(Lines) - 1 do begin
    if Pos(Prefix, Lines[i]) = 1 then begin
      Result := Copy(Lines[i], Length(Prefix) + 1, Length(Lines[i]));
      Exit;
    end;
  end;
end;

// vmfix25 helper: validate API ID is purely numeric, 1-9 digits.
function IsValidApiId(S: String): Boolean;
var
  i: Integer;
begin
  Result := False;
  if (Length(S) < 1) or (Length(S) > 9) then Exit;
  for i := 1 to Length(S) do begin
    if (S[i] < '0') or (S[i] > '9') then Exit;
  end;
  Result := True;
end;

// vmfix25 helper: validate API Hash is exactly 32 hex chars (lowercase or upper).
function IsValidApiHash(S: String): Boolean;
var
  i: Integer;
  c: Char;
begin
  Result := False;
  if Length(S) <> 32 then Exit;
  for i := 1 to 32 do begin
    c := S[i];
    if not (((c >= '0') and (c <= '9')) or ((c >= 'a') and (c <= 'f')) or ((c >= 'A') and (c <= 'F'))) then
      Exit;
  end;
  Result := True;
end;

// Pascal version of toLowerCase (Inno's Lowercase exists but for safety).
function ToLowerHex(S: String): String;
var
  i: Integer;
  c: Char;
begin
  SetLength(Result, Length(S));
  for i := 1 to Length(S) do begin
    c := S[i];
    if (c >= 'A') and (c <= 'F') then
      Result[i] := Chr(Ord(c) + 32)
    else
      Result[i] := c;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ApiId, ApiHash, ProgDataEnv, AppEnvTpl: String;
begin
  if CurStep = ssPostInstall then begin
    ApplyAndVerifyServiceAccount();

    // vmfix25 (Issue #33): if user supplied TG API credentials in the
    // wizard, persist them to BOTH:
    //   1. %ProgramData%\TeleHubX\.env       (read by supervisor candidate #3)
    //   2. {app}\.env.template               (so bootstrapUserEnv copies the
    //                                          right values into LocalService
    //                                          userEnv on first service boot)
    // Empty fields = user chose "configure later via dashboard"; don't write
    // (preserve any existing values in .env from a previous install).
    if TgApiPage <> nil then begin
      ApiId := Trim(TgApiPage.Values[0]);
      ApiHash := Trim(TgApiPage.Values[1]);
      if (ApiId <> '') and (ApiHash <> '') then begin
        ApiHash := ToLowerHex(ApiHash);
        ProgDataEnv := ExpandConstant('{commonappdata}\TeleHubX\.env');
        AppEnvTpl := ExpandConstant('{app}\.env.template');
        WriteEnvField(ProgDataEnv, 'TG_API_ID', ApiId);
        WriteEnvField(ProgDataEnv, 'TG_API_HASH', ApiHash);
        WriteEnvField(AppEnvTpl, 'TG_API_ID', ApiId);
        WriteEnvField(AppEnvTpl, 'TG_API_HASH', ApiHash);
      end;
    end;
  end;
end;

procedure InitializeWizard;
var
  ExistingApiId, ExistingApiHash: String;
begin
  // vmfix25 (Issue #33): TG API page — collect at install time so service
  // starts with credentials already in .env. Position right before
  // DataDeletePage so the install flow reads:
  //   Welcome -> Components -> Tasks -> [TG API] -> [Data folder] -> Ready
  TgApiPage := CreateInputQueryPage(wpSelectTasks,
    '配置 Telegram API 凭据',
    'TeleHubX 需要 api_id / api_hash 才能控制 Telegram 账号',
    '请从 https://my.telegram.org/apps 申请一个 App（首次需要登录 Telegram 账号），' +
    '把 api_id 和 api_hash 填到下面。' #13#10 #13#10 +
    '步骤：登录 → API development tools → 填 App title=TeleHubX, Short name=telehubx, Platform=Other → Create application → 复制 api_id 和 api_hash。' #13#10 #13#10 +
    '现在没有也可以留空跳过，装完后可在 dashboard 的「设置 → Telegram API」里配置。');
  TgApiPage.Add('API ID（数字）:', False);
  TgApiPage.Add('API Hash（32 位 hex 字符串）:', False);

  // Pre-populate from existing .env (if reinstalling and user keeps data,
  // or if installer was run before). Saves the operator from re-typing.
  ExistingApiId := ReadEnvField(ExpandConstant('{commonappdata}\TeleHubX\.env'), 'TG_API_ID');
  ExistingApiHash := ReadEnvField(ExpandConstant('{commonappdata}\TeleHubX\.env'), 'TG_API_HASH');
  TgApiPage.Values[0] := ExistingApiId;
  TgApiPage.Values[1] := ExistingApiHash;

  DataDeletePage := CreateInputOptionPage(TgApiPage.ID,
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

// vmfix25 (Issue #33): validate TG API page on Next click. Both fields must
// be filled OR both empty (skip). Reject malformed values.
function NextButtonClick(CurPageID: Integer): Boolean;
var
  ApiId, ApiHash: String;
begin
  Result := True;
  if (TgApiPage <> nil) and (CurPageID = TgApiPage.ID) then begin
    ApiId := Trim(TgApiPage.Values[0]);
    ApiHash := Trim(TgApiPage.Values[1]);

    // Both empty = explicit skip, allow.
    if (ApiId = '') and (ApiHash = '') then Exit;

    // Mixed: one filled, one empty — ambiguous, reject.
    if (ApiId = '') or (ApiHash = '') then begin
      MsgBox(
        '请填写两个字段，或都留空跳过此步骤。' #13#10 #13#10 +
        '如果暂时没有 Telegram API 凭据，可以两个都留空，' +
        '装完后在 dashboard 的「设置」里配置。',
        mbError, MB_OK);
      Result := False;
      Exit;
    end;

    if not IsValidApiId(ApiId) then begin
      MsgBox(
        'API ID 格式错误。' #13#10 +
        '应该是 1-9 位的纯数字，从 my.telegram.org/apps 获得。',
        mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if not IsValidApiHash(ApiHash) then begin
      MsgBox(
        'API Hash 格式错误。' #13#10 +
        '应该是 32 位 hex 字符串（0-9 a-f），从 my.telegram.org/apps 获得。',
        mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
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
