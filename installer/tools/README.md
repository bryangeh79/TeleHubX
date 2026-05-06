# TeleHubX Installer Tools (Phase 2)

> supervisor / stop 的源码实现。Phase 2 输出 .js（Node 直接跑），Phase 4 通过 Node SEA 编译为 .exe。
> 详见 `INSTALLER_PLAN.md` §4。

## 目录

```
installer/tools/
├── package.json
├── tsconfig.json
├── README.md (本文)
└── src/
    ├── supervisor.ts       ← 启动器入口
    ├── stop.ts             ← 停止器入口
    └── shared/
        ├── env.ts          ← .env 解析 + 运行时配置
        ├── paths.ts        ← TELEHUBX_DATA_DIR 派生路径
        ├── log.ts          ← 日志（含 secret 脱敏）
        ├── proc-windows.ts ← Get-CimInstance 查 PID + taskkill
        └── pid-store.ts    ← run/<svc>.pid JSON 读写
```

## 安装

```bash
cd installer/tools
pnpm install
```

## 运行模式

`TELEHUBX_RUNTIME_MODE` 环境变量:

| mode  | 行为 |
|-------|------|
| `dev` (默认) | 假设 PG/Redis 由 Docker 提供，仅 spawn server / agent / dashboard |
| `prod` | spawn 全部 5 个进程（含 portable PG + Memurai） |
| `probe` | **不 spawn 任何进程**，只探测端口 + 查 license + 开浏览器（本地无侵入测试） |

## 编译

```bash
pnpm build
# 输出 installer/tools/dist/{supervisor,stop}.js
```

## 用法（开发期）

### 1. 启动 — supervisor

```bash
# probe 模式（推荐先这样测，不会和 pm2 冲突）
pnpm supervisor:probe

# dev 模式（会 spawn server/agent/dashboard，先 pm2 stop all）
pm2 stop all
pnpm build
pnpm supervisor:built
```

行为：
1. 加载 `.env`（按优先级 `<dataDir>/../.env` → `<installPath>/.env` → `installer/.env.template`）
2. 创建数据目录 `%APPDATA%\TeleHubX\data\{run, logs, sessions, uploads, pgdata, memurai}`
3. 顺序启动各 service，每个 spawn 后立刻写 `<runDir>/<svc>.pid`：
   ```json
   {
     "service": "server",
     "pid": 12345,
     "exe": "C:\\...\\node.exe",
     "args": ["C:\\...\\dist\\main.js"],
     "installPath": "C:\\Program Files\\TeleHubX",
     "startedAt": 1714998012345,
     "cwd": "..."
   }
   ```
4. 按 service 类型探测健康（HTTP 或 TCP）
5. server 健康后调 `GET /cloud-license/status` 取 effectiveStatus
6. 决定 URL：
   - `unconfigured` / `locked` → `/settings/license`
   - 其它 → `/`
7. `cmd /c start "" <url>` 用默认浏览器打开
8. supervisor 自身 exit(0)；子进程 detached + unref 继续后台运行

### 2. 停止 — stop

```bash
# 干跑（不实际 taskkill，只打印将做的事）
pnpm stop:dry

# 真实停止
pnpm stop:built
```

**安全要求**：

绝对不会做：
- `taskkill /F /IM node.exe`（按进程名广泛杀）
- `Stop-Process -Name node`
- `pkill node`

只会对每个 `<svc>.pid` 做四步 PID 校验，全过才 `taskkill /PID <pid> /T /F`：

| 步骤 | 校验 |
|------|------|
| 1 | PID 仍存活 (`process.kill(pid, 0)`) |
| 2 | `ExecutablePath` 在 `installPath` 下（或与 pid 文件记录的 `exe` 完全一致） |
| 3 | `CommandLine` 包含 pid 文件 `args` 中任一字符串（>=4 字符） |
| 4 | `CreationDate` 与 `startedAt` 偏差 ≤ 5 秒 |

任一步失败 → 跳过 + 写日志 + 删 stale pid 文件 + 继续下一个 service。

反向停止顺序：dashboard → agent → server → memurai → postgres

## 日志

所有日志同时输出到：
- 控制台
- `<dataDir>/logs/supervisor.log`（supervisor + stop 共享）
- `<dataDir>/logs/<service>.log`（每个 service 子进程的 stdout/stderr）

日志自动脱敏（`shared/log.ts:REDACT_PATTERNS`）：
- `licenseKey` / `agentToken` / `password` / `TG_SESSION` / `JWT_SECRET` / 等 KV
- `THX-*` / `TLHX-*` license key 字面值

## Phase 3 / Phase 4 对接点

- **Phase 3**: 提供 `runtime/postgres/` 和 `runtime/memurai/` 二进制；supervisor 自动 detect 并按 `prod` 模式启动
- **Phase 4**:
  1. Node SEA 配置 `installer/sea-supervisor.json` + `sea-stop.json`
  2. 编译 `dist/supervisor.js` + `dist/stop.js` → `telehubx-supervisor.exe` + `telehubx-stop.exe`
  3. Inno Setup 创建桌面快捷方式指向上述 .exe，图标 `installer/assets/telehubx.ico`
  4. supervisor 末尾不打开浏览器的开关：`TELEHUBX_PROBE_NO_BROWSER=1`（已实现，便于 silent 安装）

## 不会做的事（设计明确）

- 不读写 Telegram session（agent 自己管）
- 不读写 license key 明文 / agentToken（cloud-license 自己管，存 AES-GCM）
- 不连 license server（client 在 server / agent 内调）
- 不修改任何业务表 / 数据
- 不广泛杀 node.exe，只杀 pid 文件登记的 PID 经过四步校验后
