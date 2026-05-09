; TeleHubX SeedPack v1 (vmfix20 / Issue #28) Inno Setup script
; Run AFTER main TeleHubX-Setup-*.exe is installed.
; Drops curated assets + chat-script JSON packs into %ProgramData%\TeleHubX\data
; and restarts the service so onModuleInit hooks register them in DB.

#define AppName       "TeleHubX SeedPack"
#define AppVersion    "1.0.0"
#define AppPublisher  "Starbright Solutions"
#define BuildTag      "vmfix20"

[Setup]
AppId={{C8F4DA13-2D2B-49FF-A001-9F3A8C6B7E2F}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={commonappdata}\TeleHubX\data
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
DisableWelcomePage=no
UsePreviousAppDir=no
LicenseFile=
OutputBaseFilename=TeleHubX-SeedPack-{#AppVersion}-{#BuildTag}
OutputDir=..\Output
SetupIconFile=..\assets\telehubx.ico
WizardImageFile=..\assets\telehubx-banner.bmp
WizardSmallImageFile=..\assets\telehubx-banner-small.bmp
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern
ShowLanguageDialog=no
Uninstallable=no

[Languages]
Name: "chs"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; All staged content goes under %ProgramData%\TeleHubX\data\.
; Source: staging\assets\_builtin\* -> {commonappdata}\TeleHubX\data\assets\_builtin\
; Source: staging\script-packs\*    -> {commonappdata}\TeleHubX\data\script-packs\
Source: "staging\assets\_builtin\*"; DestDir: "{commonappdata}\TeleHubX\data\assets\_builtin"; Flags: recursesubdirs ignoreversion createallsubdirs
Source: "staging\script-packs\*";    DestDir: "{commonappdata}\TeleHubX\data\script-packs";    Flags: recursesubdirs ignoreversion createallsubdirs

[Run]
; vmfix20 (Issue #28): grant LocalService access to the new files
; (matches the main installer's icacls call).
Filename: "icacls"; Parameters: """{commonappdata}\TeleHubX\data\assets"" /grant ""NT AUTHORITY\LocalService:(OI)(CI)F"" /T /Q"; Flags: runhidden waituntilterminated; StatusMsg: "Granting service access to assets directory..."
Filename: "icacls"; Parameters: """{commonappdata}\TeleHubX\data\script-packs"" /grant ""NT AUTHORITY\LocalService:(OI)(CI)F"" /T /Q"; Flags: runhidden waituntilterminated; StatusMsg: "Granting service access to script-packs..."

; Restart the TeleHubX service so AssetsService.onModuleInit +
; ChatScriptsService.onModuleInit pick up the new files. If the service
; isn't installed yet (user ran SeedPack BEFORE main installer), these are
; no-ops with non-fatal exit codes.
Filename: "{cmd}"; Parameters: "/C sc.exe stop TeleHubX"; Flags: runhidden waituntilterminated; StatusMsg: "Stopping TeleHubX service to refresh seed cache..."
Filename: "{cmd}"; Parameters: "/C sc.exe start TeleHubX"; Flags: runhidden waituntilterminated; StatusMsg: "Restarting TeleHubX service to register seed assets..."

[Messages]
SetupAppTitle=TeleHubX SeedPack 安装
SetupWindowTitle=TeleHubX SeedPack {#AppVersion} 安装
WelcomeLabel1=欢迎安装 TeleHubX 内置素材库
WelcomeLabel2=本素材包包含 ~97 张图片、~200 段语音、~25 段精选视频，以及 80 个聊天剧本（A+B 30 / A+B+C+D 50）。%n%n安装完成后，TeleHubX 服务会自动重启，新内容会出现在 dashboard 的素材库 / 剧本库中。%n%n请确保 TeleHubX 主程序已经安装。
FinishedLabel=TeleHubX SeedPack 已安装。素材已写入 %n  %1%n%n服务已重启。打开桌面 "TeleHubX Dashboard" 查看新素材。
