# Phase 3.5 + Phase 4 交付与衔接说明

> 本文件描述构建机器上从源码到 `TeleHubX-Setup-1.0.0.exe` 的完整流程。
> Phase 1-3 已完成（commits c443c87 / b2f5713 / 58a10fd）。

---

## 一句话总结

```powershell
# 在 Windows PowerShell（管理员可选）执行：
.\installer\scripts\fetch-vendor.ps1   # 一次性: 准备 vendor/ (Node 自动, PG/Memurai 手动)
.\installer\scripts\png-to-ico.ps1 -Source installer\assets\telehubx-logo.png -Out installer\assets\telehubx.ico
.\installer\build.ps1                  # 出: installer\Output\TeleHubX-Setup-1.0.0.exe
```

---

## Phase 3.5：vendor/ 准备

`vendor/` 由 `.gitignore` 排除（二进制不入仓）。三个组件：

| 组件 | 自动 / 手动 | 说明 |
|------|-----|------|
| `vendor/node-v20-win-x64/node.exe` | 自动（fetch-vendor.ps1） | 从 nodejs.org 下载 v20.18.0 zip 自动解压 |
| `vendor/postgres-16-portable/` | 手动 | EnterpriseDB 官方 binaries zip + 加 pgvector dll |
| `vendor/memurai/` | 手动 | memurai.com Developer 版（dev/eval）或 Enterprise 版（生产） |

**Memurai 授权**: Memurai Developer EULA 不允许生产部署。客户分发前必须确认 Memurai Enterprise / Memurai for Redis 授权。

---

## Phase 4：打包 / SEA / Inno Setup

### 资源清单

```
installer/
├── .env.template                      # 安装包内置 env (无 secret)
├── telehubx.iss                       # Inno Setup 主脚本
├── build.ps1                          # 端到端流水线
├── build-dist.cjs                     # Node 装配 dist 目录
├── sea-supervisor.json                # Node SEA 配置 (supervisor)
├── sea-stop.json                      # Node SEA 配置 (stop)
├── PHASE4_HANDOFF.md                  # 本文
├── README.md                          # Phase 1-3 进度
├── assets/
│   ├── README.md                      # 图标资源清单
│   ├── telehubx-logo.png              # *用户放置* 源图 1024×1024
│   ├── telehubx.ico                   # 自动生成 (gitignored)
│   ├── telehubx-banner.bmp            # 自动生成 (gitignored)
│   └── telehubx-banner-small.bmp      # 自动生成 (gitignored)
├── runtime/
│   ├── README.md                      # 二进制布局说明
│   └── postgres/init-pgdata.cjs       # 首启 idempotent 初始化
├── scripts/
│   ├── fetch-vendor.ps1               # 准备 vendor/
│   ├── png-to-ico.ps1                 # 图标转换
│   ├── bundle-tools.cjs               # esbuild 打 supervisor/stop 单文件
│   └── secret-scan.mjs                # CI gate
├── tools/                             # supervisor/stop 源码
│   ├── src/
│   ├── test/safety-test.cjs           # stop 自动化安全测试
│   ├── package.json
│   └── tsconfig.json
└── dist/                              # build.ps1 输出 (gitignored)
    ├── app/{server,agent,dashboard}/
    ├── tools/{telehubx-supervisor.exe, telehubx-stop.exe}
    ├── runtime/{node,postgres,memurai}/
    ├── assets/telehubx.ico
    └── .env
```

### build.ps1 步骤

```
1) Vendor check (node + postgres + memurai)
2) build-dist.cjs:
   - pnpm build server / agent / dashboard / installer-tools
   - 拷贝到 installer/dist/{app,tools,runtime,.env}
   - 拷贝 vendor 二进制到 dist/runtime/
3) secret-scan installer/dist (CI gate, fail-fast)
4) bundle-tools.cjs:
   - esbuild --bundle supervisor.ts → dist-bundle/supervisor.cjs
   - esbuild --bundle stop.ts       → dist-bundle/stop.cjs
5) Node SEA:
   - node --experimental-sea-config sea-supervisor.json → supervisor.blob
   - copy node.exe + postject inject blob → telehubx-supervisor.exe
   - 同上 stop
6) Stage SEA exe + telehubx.ico → installer/dist/tools + installer/dist/assets
7) ISCC.exe installer/telehubx.iss → installer/Output/TeleHubX-Setup-1.0.0.exe
```

### Inno Setup 关键设计

- **DefaultDirName**: `{autopf}\TeleHubX` → `C:\Program Files\TeleHubX` (admin)
- **桌面快捷方式（Tasks: desktopicon）**:
  - `Start TeleHubX` → `{app}\tools\telehubx-supervisor.exe` + telehubx.ico
  - `Stop TeleHubX`  → `{app}\tools\telehubx-stop.exe` + telehubx.ico
- **开始菜单**: `{group}\Start TeleHubX` / `Stop TeleHubX` / `Uninstall TeleHubX`
- **可选开机自启（Tasks: autostart, 默认未勾）**:
  - 创建 schtasks 任务 `TeleHubX Autostart` ON_LOGON 高权限
- **首次安装后**:
  - copy `.env.template` → `%APPDATA%\TeleHubX\.env`（仅当目标不存在）
  - 提示 "Launch TeleHubX now?" (skipifsilent)
- **卸载流程**:
  - 先调 `telehubx-stop.exe` 干净停止全部服务
  - 删除 schtasks 任务（如果存在，失败忽略）
  - **数据保留 by default**：MsgBox 二次确认是否删除 `%APPDATA%\TeleHubX`
  - 默认按钮 = "保留"（误点保护）

---

## 验收路径

构建机器：

```powershell
# 1. vendor 准备 (一次性)
.\installer\scripts\fetch-vendor.ps1

# 2. 把 telehubx-logo.png 放入 installer\assets\

# 3. 端到端打包
.\installer\build.ps1
```

成功后输出：`installer\Output\TeleHubX-Setup-1.0.0.exe` (~120MB 压缩后)。

测试机器（全新 Win11）：

```
1. 双击 TeleHubX-Setup-1.0.0.exe
2. 同意安装 → 创建桌面快捷方式 (默认勾选)
3. 安装完成 → 自动启动 TeleHubX (默认勾选)
4. 浏览器自动打开 → /settings/license (因未激活)
5. 输入 License Key + Email + Password → 激活
6. 跳到 dashboard 首页
7. 添加账号 → Send OTP → 验证可走通
8. 双击桌面 "Stop TeleHubX" → 5 进程全停, 不误杀其他 node
9. 双击桌面 "Start TeleHubX" → 全部恢复
10. 卸载 → 弹 confirm 是否删数据 → 默认保留
```

---

## stop 安全测试（必须保留为 release gate）

```bash
cd installer/tools && pnpm test:safety
# 或
node installer/tools/test/safety-test.cjs
```

6 场景全过为通过条件。失败任一项 → release block。

---

## 已知限制 / TODO

| 项 | 状态 | 备注 |
|----|------|------|
| postject SEA 注入 | 已 `pnpm add -Dw postject` (Issue #11) | |
| Memurai 商业授权 + 下载 | 阻塞: CloudFront 403 | 需邮箱注册手动下载，上线前确认 Enterprise 授权 |
| EV 代码签名 | 未做 | 否则 SmartScreen 警告 |
| 自动更新 | 未做 | 后续可加 squirrel.windows |
| pgvector .dll Windows pre-built | **已找到 (Issue #11)** | 社区构建 `andreiramani/pgvector_pgsql_windows` v0.8.2-pg16；非官方需评估 |

## Critical blockers found in Issue #11 testing

### A. `pnpm deploy` destroys workspace source (3 occurrences)

**Symptom**: Running `pnpm --filter @telehubx/<pkg> deploy --prod <target>` deleted
`apps/server/tsconfig.json`, `apps/server/src/*`, `apps/agent/src/*`, etc.
This was reproducible 3 times in a row, with target both inside (`installer/dist`)
and outside (`%TEMP%/telehubx-deploy-*`) the workspace, with and without
`--config.node-linker=hoisted`.

**Root cause hypothesis**: pnpm walks workspace symlinks during deploy and confuses
source dirs with deploy targets when both are reachable from cwd. The first deploy
in a build-dist run usually succeeds; the second consistently destroys source.

**Mitigation**: `installer/build-dist.cjs` no longer calls `pnpm deploy`. It now:
- Copies `apps/<pkg>/dist/` and `apps/<pkg>/package.json` into `installer/dist/app/<pkg>/`
- Writes `NODE_MODULES_REQUIRED.txt` marker (no node_modules)
- Includes a canary check (`safeDeployAndMove` scaffolding kept for future use)

**Production deps install** (must be done out-of-tree by build.ps1, NOT yet automated):
```powershell
# For each app (server, agent), in a clean directory:
$pkg = 'server'  # or agent
$tmp = Join-Path $env:TEMP "telehubx-pack-$pkg"
pnpm pack --filter "@telehubx/$pkg" --pack-destination $tmp
# Extract pkg.tgz, then:
cd "$tmp\package"
npm install --omit=dev
# Copy node_modules back to installer/dist/app/$pkg/node_modules
```

This must be implemented and tested in a separate workstream (Issue #12 candidate).

### B. ISCC + pnpm `.pnpm/<long-hash>/` exceeds Windows MAX_PATH

**Symptom**: `Error in installer/telehubx.iss: The system cannot find the path specified.`
during `Compressing:` of `node_modules\.pnpm\@nestjs+bull-shared@11.0.4_@nestjs+common@11.1.19_class-transformer@0.5.1_class-validator@0.1_<hash>\node_modules\@nestjs\core\injector\opaque-key-factory\interfaces\module-opaque-key-factory.interface.d.ts` (~295 chars).

**Tested workarounds**:
- `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1` already set → **does not help** (ISCC.exe lacks the long-path manifest opt-in).
- Junction `C:\T → installer/dist` + short-path .iss (`Source: "C:\T\app\*"`) → **still fails** because `.pnpm/<package@version>_<peer-hashes>/` is itself >250 chars from the junction root.

**Recommendation**: When deps install is fixed via npm (Blocker A), `npm install --omit=dev`
produces a flat `node_modules/<pkg>/...` layout (no `.pnpm/<hash>/` deep paths). This
single change should resolve Blocker B as well.

**Helper artifact added**: `installer/scripts/make-shortpath-iss.cjs` generates
`installer/telehubx-shortpath.iss` with `C:\T\*` paths for use with the junction
workaround. Kept in repo for future manual debugging.
