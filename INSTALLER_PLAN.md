# TeleHubX Windows 安装包交付方案 (v1.0)

> 文档面向：实施工程师 / 后续 Claude session
> 项目根目录：`C:\AI_WORKSPACE\Telegram Auto Bot`
> 目标：客户**零开发环境**双击安装，桌面快捷方式启停，License 激活后绑定机器
> 状态：方案已确认（B/B/B），Phase 1 实施中

---

## 0. 已确认决策（B/B/B）

当前项目运行依赖 PostgreSQL + Redis（Docker）+ pgvector。客户 PC 上不能装 Docker，方案：

| # | 依赖 | 方案 |
|---|------|------|
| 1 | PostgreSQL | **B**: 内嵌 Postgres Portable（含 pgvector .dll）随安装包分发 |
| 2 | Redis | **B**: 内嵌 Memurai（Redis Windows fork） |
| 3 | Node 运行时 | **B**: 安装包内置 node.exe，不要求客户装 Node |

**安装包预计体积**：约 280–350 MB

---

## 1. 总体架构

```
%PROGRAMFILES%\TeleHubX\                    ← 安装目录（程序+运行时，只读）
├── app\
│   ├── server\                              ← Nest 编译后 dist
│   ├── agent\                               ← Agent 编译后 dist
│   └── dashboard\                           ← Vite build 产物
├── runtime\
│   ├── node\node.exe                        ← v20 LTS
│   ├── postgres\                            ← Postgres Portable v16 + pgvector
│   └── memurai\                             ← Redis-compatible
├── tools\
│   ├── telehubx-supervisor.exe              ← 自研启停管理器（Node SEA）
│   └── telehubx-stop.exe
├── assets\
│   └── telehubx.ico
└── uninstall.exe                            ← Inno 生成

%APPDATA%\TeleHubX\                          ← 数据目录（用户可写）
├── data\
│   ├── pgdata\                              ← Postgres data
│   ├── memurai\
│   ├── cloud-license.bin
│   ├── machine-fingerprint.txt
│   └── agent-token.bin                      ← AES-GCM 加密的 license token
├── sessions\                                ← Telegram StringSession 加密存储
├── uploads\                                 ← 知识库文件、广告素材
├── logs\
│   ├── server.log / agent.log / dashboard.log
│   └── supervisor.log
└── run\
    ├── server.pid / agent.pid / dashboard.pid
    ├── postgres.pid / memurai.pid
    └── ports.json                           ← 实际监听端口快照
```

---

## 2. 安装包技术栈

| 组件 | 选型 | 备注 |
|------|------|------|
| 安装器制作 | **Inno Setup 6**（已安装） | 脚本：`installer/telehubx.iss` |
| Node 打包 | **Node SEA**（单文件可执行） | supervisor 与 stop 工具用 |
| 后端编译 | `pnpm build`（Nest tsc）→ Node 直跑 | 不用 pkg（native 模块） |
| 图标转换 | `png` → `ico`（multi-size） | 256/128/64/48/32/16 |
| 签名 | （可选）EV Code Signing | 避免 SmartScreen |

---

## 3. Logo / 图标准备

源文件：用户提供的渐变 X 标识（PNG 1024×1024）

生成产物：
```
installer/assets/
├── telehubx.ico                       ← 多尺寸 (256/128/64/48/32/16)
├── telehubx-256.png                   ← 安装器界面
├── telehubx-installer-banner.bmp      ← 164×314（左侧大图）
└── telehubx-installer-small.bmp       ← 55×58（顶部小图）
```

---

## 4. Supervisor / 进程管理（替代 PM2）

### 4.1 telehubx-supervisor.exe（启动器）

**职责**：
1. 读 `%APPDATA%\TeleHubX\config.json` → 端口、数据路径
2. 顺序启动：postgres → memurai → server → agent → dashboard
3. 写 PID + 命令行 + 启动时间戳 → `run/<service>.pid`（JSON）：
   ```json
   {
     "pid": 12345,
     "exe": "C:\\Program Files\\TeleHubX\\runtime\\node\\node.exe",
     "args": ["C:\\Program Files\\TeleHubX\\app\\server\\dist\\main.js"],
     "installPath": "C:\\Program Files\\TeleHubX",
     "startedAt": "2026-05-06T18:32:11.000Z",
     "service": "server"
   }
   ```
4. 健康检查：`http://127.0.0.1:9800/health` 返回 200
5. 查 license 状态 → 决定打开 URL：
   - 未激活 / 锁定 → `/settings/license`
   - 已激活 → `/`
6. 默认浏览器打开

### 4.2 telehubx-stop.exe（停止器）—— 安全关键

**绝对不能**：`taskkill /F /IM node.exe`

**必须做的 PID 校验四步**：
```typescript
function isOurProcess(pidFile: string): boolean {
  const meta = JSON.parse(readFileSync(pidFile, 'utf8'));
  const live = wmic(`process where ProcessId=${meta.pid} ...`);
  if (!live) return false;                                                     // 1) PID 活
  if (!live.exePath.toLowerCase().startsWith(meta.installPath.toLowerCase())) return false; // 2) 路径
  if (!live.cmdLine.includes(meta.args[0])) return false;                     // 3) 命令行
  if (Math.abs(live.creationDate - meta.startedAt) > 2000) return false;      // 4) 启动时间
  return true;
}
```

只有 4 项全过才 `taskkill /PID <pid> /T`。

停止顺序：dashboard → agent → server → memurai → postgres

---

## 5. License 激活流程

### 5.1 后端 API

| API | 方法 | 入参 | 出参 |
|-----|------|------|------|
| `/licenses/activate` | POST | `{licenseKey, email, password, machineFingerprint}` | `{agentToken, expiresAt, maxAccounts, features}` |
| `/licenses/heartbeat` | POST | `{agentToken, machineFingerprint}` | `{status: 'ok'\|'expired'\|'revoked'\|'user_disabled'}` |
| `/licenses/status` | GET（本地 cache） | - | `{activated, expiresAt, status, ...}` |

**心跳**：30 分钟一次，结果写 `cloud-license.bin`（AES-GCM with machine-derived key）。
**断网容忍**：失败 7 天内仍允许使用。

### 5.2 LicenseGuard 中间件

新增 NestJS Guard，挂在以下路由：
- `POST /accounts` (新增账号 + maxAccounts 校验)
- `POST /tasks` (新增任务)
- `POST /campaigns` (新增广告)
- `POST /warmup/start`
- `POST /cs/auto-reply`

**只读路由不挂** → 历史数据始终可查。

锁定时返回 `403 LicenseLockedException`，前端拦截弹 modal。

### 5.3 前端 /settings/license

- 未激活：[License Key] [Email] [Password] [激活]
- 已激活：状态 / 过期 / maxAccounts / [刷新心跳]
- 锁定：全站红 banner + Mutation 操作弹 LicenseLockedModal

### 5.4 机器指纹

`SHA256(MachineGuid + CPU.ProcessorId + Disk.SerialNumber)`

---

## 6. 环境变量策略

### 6.1 安装包内置 .env（公开）
```env
NODE_ENV=production
LICENSE_SERVER_URL=https://telehubx-license.starbright-solutions.com
TELEHUBX_DATA_DIR=%APPDATA%\TeleHubX
SERVER_PORT=9800
DASHBOARD_PORT=9601
PG_PORT=5436
REDIS_PORT=6386
DB_TYPE=postgres
DB_HOST=127.0.0.1
DB_USER=telehubx
DB_PASS=local-only-not-secret
DB_NAME=telehubx
TG_API_ID=<共享池>
TG_API_HASH=<共享池>
```

### 6.2 安装包**绝对不能**含
```
ADMIN_TOKEN
LICENSE_ADMIN_TOKEN
LICENSE_PEPPER
AGENT_TOKEN_SECRET
USER_PASSWORD_PEPPER
CLOUDFLARE_API_TOKEN
*.pem / *.key / *_PRIVATE_KEY
```

构建脚本必须有 secret 扫描 gate。

### 6.3 私密 secret → license server 动态派发

`AGENT_TOKEN_SECRET` 等由 `/licenses/activate` 响应字段返回，本地 AES-GCM 加密保存。

---

## 7. Inno Setup 关键片段

```pascal
[Setup]
AppName=TeleHubX
AppVersion=1.0.0
DefaultDirName={pf}\TeleHubX
SetupIconFile=assets\telehubx.ico
PrivilegesRequired=admin

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: checkedonce
Name: "autostart"; Description: "开机自启"; Flags: unchecked

[Icons]
Name: "{commondesktop}\启动 TeleHubX"; Filename: "{app}\tools\telehubx-supervisor.exe"; \
  IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon
Name: "{commondesktop}\停止 TeleHubX"; Filename: "{app}\tools\telehubx-stop.exe"; \
  IconFilename: "{app}\assets\telehubx.ico"; Tasks: desktopicon

[Code]
// 卸载时自定义页面让用户选「保留数据 / 彻底删除数据」
// 默认保留
```

---

## 8. 构建流水线 installer/build.ps1

```powershell
pnpm --filter @telehubx/server build
pnpm --filter @telehubx/agent build
pnpm --filter @telehubx/dashboard build
# 复制 dist 到 dist/app/{server,agent,dashboard}
node --experimental-sea-config installer\sea-supervisor.json
# 复制 vendor: node / postgres-portable / memurai
# Secret 扫描 gate
node installer\scripts\secret-scan.js dist
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\telehubx.iss
```

---

## 9. 业务代码必要改动清单

| 文件 / 模块 | 改动 | 工时 |
|------------|------|------|
| `apps/server/src/config/configuration.ts` | 读 `TELEHUBX_DATA_DIR` 替代硬编码 cwd | 2h |
| `apps/server/src/licenses/license.guard.ts` | 新建 | 4h |
| `apps/server/src/licenses/licenses.service.ts` | activate / heartbeat / decrypt | 8h |
| `apps/server/src/main.ts` | 启动读 cloud-license.bin / 心跳定时器 | 3h |
| `apps/dashboard/src/pages/SettingsLicensePage.tsx` | 新建激活页 | 6h |
| `apps/dashboard/src/components/LicenseLockedModal.tsx` | 全局 mutation 拦截弹窗 | 3h |
| `apps/dashboard/src/services/api.ts` | axios interceptor 捕获 403 | 2h |
| `apps/agent/src/main.ts` | 启动验 agent-token.bin；锁定时停 worker | 4h |
| `apps/server/src/database/datasource.ts` | Postgres 连接改读 portable 端口 | 1h |
| **小计业务代码** | | **33h** |

| 安装包工程 | 工时 |
|-----------|------|
| supervisor / stop 工具 | 12h |
| Inno Setup 脚本 + 资源 | 6h |
| 构建流水线 + secret 扫描 | 5h |
| Postgres Portable / Memurai 集成 | 8h |
| 全新 Win11 VM 端到端测试 | 6h |
| **小计安装工程** | **37h** |

**总工时：约 70 人时 / 9-10 个工作日**

---

## 10. 验收测试矩阵

| # | 测试 | 实现支撑点 |
|---|------|-----------|
| 1 | 全新 Win 安装 | Inno Setup PrivilegesRequired=admin |
| 2 | 双击启动成功 | supervisor 5 进程顺序启动 + 健康探测 |
| 3 | 自动打开前端 | supervisor 末步开浏览器 |
| 4 | 未激活进 /settings/license | supervisor URL 选择 |
| 5 | 激活成功 | POST /licenses/activate + 写 cloud-license.bin |
| 6 | 添加账号 + Send OTP | LicenseGuard 通过 + agent createSession |
| 7 | maxAccounts 生效 | LicenseGuard 计数校验 |
| 8 | verify / heartbeat 正常 | 30min 定时器 |
| 9 | 双击停止 | telehubx-stop.exe 4 步 PID 校验 |
| 10 | 再次启动恢复 | pgdata 持久化 |
| 11 | revoked/expired/disabled 锁定 | LicenseGuard 抛 403 + Modal |
| 12 | 历史数据可查 | Guard 不挂 GET 路由 |

---

## 11. 安全清单

- [x] 安装包不含 ADMIN_TOKEN / LICENSE_ADMIN_TOKEN / PEPPER 等
- [x] AGENT_TOKEN_SECRET license server 动态派发，AES-GCM 加密
- [x] 机器指纹绑定
- [x] CI 阶段 secret 扫描 gate
- [x] 停止器只杀符合「PID + 路径 + 命令行 + 启动时间」四项校验的进程
- [x] %APPDATA% 目录权限：仅当前用户可读写
- [ ] （可选）EV 代码签名

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Postgres Portable 启动失败 | 探测 + 失败回退 SQLite + sqlite-vss |
| Memurai 端口冲突 | 端口 6386 非默认；冲突时随机重选 |
| 安装包 350MB | CDN + 断点续传 |
| 机器指纹漂移 | 提供「申请重新激活」工单流程 |
| 心跳断网 > 7d | 锁定但保留只读访问 |

---

## 13. 推进顺序

```
Phase 0 (已完成)
  └─ 设计冻结 + 用户确认 PG/Redis/Node 三选项 (B/B/B)

Phase 1 (~3d) 业务代码改造  ← 当前
  ├─ License Guard + activate API
  ├─ /settings/license 页 + LockedModal
  └─ 数据目录配置抽象 (TELEHUBX_DATA_DIR)

Phase 2 (~3d) 进程管理工具
  ├─ supervisor / stop 工具实现 (Node SEA)
  ├─ PID 校验四步逻辑
  └─ 单机本地跑通

Phase 3 (~2d) 运行时打包
  ├─ Postgres Portable 集成 + 自动 initdb
  ├─ Memurai 集成
  └─ 端到端：解压一个文件夹手动启动

Phase 4 (~2d) Installer 组装
  ├─ Inno Setup 脚本 + 图标资源
  ├─ 构建脚本 + secret 扫描
  └─ 干净 Win11 VM 跑 12 项验收

Phase 5 交付
  └─ TeleHubX-Setup-1.0.0.exe (~320MB)
```
