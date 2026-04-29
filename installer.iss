; TeleHubX Setup Script
#define MyAppName "TeleHubX"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "TeleHubX"
#define MyAppURL "https://github.com/bryangeh79/TeleHubX"
#define MyAppExeName "TeleHubX.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=C:\AI_WORKSPACE\Telegram Auto Bot\dist
OutputBaseFilename=TeleHubX_Setup_v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
DisableWelcomePage=no
DisableDirPage=auto

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
; Bundle Node.js runtime
Source: "C:\Program Files\nodejs\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "C:\Program Files\nodejs\node_modules\npm\*"; DestDir: "{app}\runtime\npm"; Flags: ignoreversion recursesubdirs createallsubdirs

; TeleHubX application files
Source: "C:\AI_WORKSPACE\Telegram Auto Bot\apps\server\dist\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "C:\AI_WORKSPACE\Telegram Auto Bot\apps\server\package.json"; DestDir: "{app}\server"; Flags: ignoreversion
Source: "C:\AI_WORKSPACE\Telegram Auto Bot\apps\server\node_modules\*"; DestDir: "{app}\server\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "C:\AI_WORKSPACE\Telegram Auto Bot\apps\agent\dist\*"; DestDir: "{app}\agent"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "C:\AI_WORKSPACE\Telegram Auto Bot\apps\agent\package.json"; DestDir: "{app}\agent"; Flags: ignoreversion
Source: "C:\AI_WORKSPACE\Telegram Auto Bot\apps\agent\node_modules\*"; DestDir: "{app}\agent\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "C:\AI_WORKSPACE\Telegram Auto Bot\apps\dashboard\dist\*"; DestDir: "{app}\dashboard"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\TeleHubX"; Filename: "{app}\TeleHubX.exe"
Name: "{group}\Dashboard"; Filename: "http://localhost:9600"
Name: "{commondesktop}\TeleHubX"; Filename: "{app}\TeleHubX.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\runtime\node.exe"; Parameters: "server/dist/main.js"; WorkingDir: "{app}"; StatusMsg: "Starting TeleHubX Server..."; Flags: nowait skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /F /IM node.exe 2>nul"; Flags: runhidden

[Code]
function InitializeSetup: Boolean;
begin
  Result := True;
end;
