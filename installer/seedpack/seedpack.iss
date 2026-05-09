; TeleHubX SeedPack v1 (vmfix20 / Issue #28) Inno Setup script
; Run AFTER main TeleHubX-Setup-*.exe is installed.
; Drops curated assets + chat-script JSON packs into %ProgramData%\TeleHubX\data
; and restarts the service so onModuleInit hooks register them in DB.

#define AppName       "TeleHubX SeedPack"
#define AppVersion    "1.0.0"
#define AppPublisher  "Starbright Solutions"
#define BuildTag      "vmfix21"

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

; vmfix21 (Issue #29): restart the TeleHubX service so the OnModuleInit
; hooks pick up the new files. The naive `sc stop` immediately followed
; by `sc start` (vmfix20 SeedPack) hit a Windows SCM race where postgres
; would still be in pg_ctl-stop teardown when the new supervisor started,
; leaving stale postgres.exe processes that bind port 5436 and break
; pg_ctl on the new supervisor.
;
; Fix: 3-step sequence with a fixed sleep between stop and start. We
; deliberately avoid PowerShell's brace-laden polling loop here because
; Inno Setup parses any `{` as a constant marker — escaping every brace
; doubles the script size and is fragile. The fixed 10s sleep is plenty
; for pg_ctl stop -m fast (typically <1s) to complete its teardown,
; including postgres process exit and lock file cleanup.
;
; If service isn't installed (SeedPack run before main), `sc stop` and
; `sc start` both return non-zero but we ignore exit codes via cmd /C.
Filename: "{cmd}"; Parameters: "/C sc.exe stop TeleHubX"; Flags: runhidden waituntilterminated; StatusMsg: "Stopping TeleHubX service..."
Filename: "{cmd}"; Parameters: "/C timeout /t 10 /nobreak > nul"; Flags: runhidden waituntilterminated; StatusMsg: "Waiting for clean shutdown (10s)..."
Filename: "{cmd}"; Parameters: "/C sc.exe start TeleHubX"; Flags: runhidden waituntilterminated; StatusMsg: "Starting TeleHubX service to register seed assets..."

[Messages]
SetupAppTitle=TeleHubX SeedPack 安装
SetupWindowTitle=TeleHubX SeedPack {#AppVersion} 安装
WelcomeLabel1=欢迎安装 TeleHubX 内置素材库
WelcomeLabel2=本素材包包含 ~97 张图片、~200 段语音、~25 段精选视频，以及 80 个聊天剧本（A+B 30 / A+B+C+D 50）。%n%n安装完成后，TeleHubX 服务会自动重启，新内容会出现在 dashboard 的素材库 / 剧本库中。%n%n请确保 TeleHubX 主程序已经安装。
FinishedLabel=TeleHubX SeedPack 已安装。素材已写入 %n  %1%n%n服务已重启。打开桌面 "TeleHubX Dashboard" 查看新素材。
