# TeleHubX Installer Workspace

> 该目录后续放 Inno Setup 脚本、supervisor / stop 工具源码、构建流水线。
> 详细方案见仓库根 `INSTALLER_PLAN.md`（v1.0，2026-05-06）。
> 决策已确认：Postgres Portable + Memurai + 内置 Node = **B/B/B**

## 当前进度（Phase 1）

- [x] 设计冻结（`INSTALLER_PLAN.md`）
- [x] 客户端 license 基建（`apps/server/src/cloud-license/*`）
  - [x] CloudLicenseService（verify / heartbeat / grace / hard lock）
  - [x] LicenseStorage（AES-GCM 本地加密）
  - [x] 机器指纹（Windows MachineGuid 派生）
  - [x] CloudLicenseClient（与 license server 通信）
- [x] License Guard（declarative `@LicenseGate` decorator）
- [x] 现有 imperative gate（`accounts.service` + `tasks.service` 调用 `canAddAccount` / `canRunTasks`）
- [x] /settings/license 前端激活页（`apps/dashboard/src/pages/license/LicensePage.tsx`）
- [x] 数据目录抽象（`apps/server/src/common/paths.ts`，按 `TELEHUBX_DATA_DIR` 派生）
- [x] `installer/.env.template`（公开值 only）
- [x] `installer/scripts/secret-scan.mjs`（CI gate）
- [ ] supervisor / stop 工具（Phase 2）
- [ ] Postgres Portable + Memurai 集成（Phase 3）
- [ ] Inno Setup 脚本（Phase 4）

## 安装包绝对禁止打包的环境变量

构建期 `secret-scan.mjs` 检测以下任一字符串赋值即失败：

```
ADMIN_TOKEN
LICENSE_ADMIN_TOKEN
LICENSE_PEPPER
LICENSE_SIGNING_SECRET
AGENT_TOKEN_SECRET
AGENT_TOKEN
USER_PASSWORD_PEPPER
JWT_SECRET
SESSION_ENCRYPTION_KEY
CLOUDFLARE_API_TOKEN
CF_API_TOKEN
```

外加 PEM 私钥头检测。

## Phase 2 工作单（next session 接手）

1. **`tools/supervisor/`** — Node SEA 编译为 `telehubx-supervisor.exe`
   - 顺序启动：postgres → memurai → server → agent → dashboard
   - 写 PID JSON 到 `%APPDATA%\TeleHubX\data\run\<svc>.pid`
   - 健康检查 `GET http://127.0.0.1:9800/health`
   - 查 `cloud-license.bin` 状态决定打开 URL：
     - `effectiveStatus = 'unconfigured' | 'locked'` → `/settings/license`
     - 其它 → `/`
   - 默认浏览器 `start "" <url>`

2. **`tools/stop/`** — Node SEA 编译为 `telehubx-stop.exe`
   - 严格 PID 校验四步：PID 活 + exePath 在安装目录 + cmdLine 匹配 + 启动时间 ±2s
   - 全过才 `taskkill /PID <pid> /T`
   - 反向顺序停：dashboard → agent → server → memurai → postgres
   - 失败的 service 写日志但**不阻塞**整体停止

3. **`vendor/`** — 不入仓，由 build.ps1 下载/解压
   - `node-v20.18-win-x64`
   - `pgsql-portable-16` + `pgvector` dll
   - `memurai`

4. **`telehubx.iss`** — Inno Setup 脚本（参考 `INSTALLER_PLAN.md` §7）

5. **`build.ps1`** — 构建流水线（参考 `INSTALLER_PLAN.md` §8）
   - 必须调 `secret-scan.mjs` 并失败即 abort

## Phase 1 完成说明

Phase 1 业务代码侧已完成最小集，**未触碰** Telegram session、proxy、campaign、warmup、agent
执行逻辑——所有现有运行链路保持原状，只新增了:

- `apps/server/src/common/paths.ts`（路径 helper）
- `apps/server/src/cloud-license/license.guard.ts`（声明式 Guard）
- `apps/server/src/cloud-license/license-gate.decorator.ts`
- `installer/.env.template`
- `installer/scripts/secret-scan.mjs`
- `installer/README.md`（本文）

`cloud-license.service.ts` 改用 `getDataPaths()` 替代行内拼路径，是兼容性修改不影响行为。
