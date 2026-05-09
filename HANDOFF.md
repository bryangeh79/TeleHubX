# TeleHubX — 会话交接 (2026-05-09)

> **给下一个 Claude Code 会话**：读完这一份 + `工程技术蓝图.md` + `CLAUDE.md` 第七节，即可无缝接手。
> 上一轮主要做了 **vmfix15 → vmfix25 全套 ship-ready 修复 + 工程技术蓝图编写**，跨 ~30 个 commit。
> HEAD：`b901695`，已 push GitHub。

---

## 0. 立刻执行（新 session 开机后第一件事）

```powershell
cd "C:\AI_WORKSPACE\Telegram Auto Bot"
git log --oneline -10                        # 看最新 commit (期望 HEAD = b901695)
git status                                    # 应该 clean（除了 data/ untracked）
ls installer\Output\TeleHubX-Setup-1.0.0-*.exe  # 期望看到 vmfix24 / vmfix25
Get-Content installer\Output\TeleHubX-Setup-1.0.0-vmfix25.exe -Stream:zone.identifier  # 检查 SmartScreen 标记（可选）
```

**先读三份文档**：

1. **`工程技术蓝图.md`**（仓库根目录，1274 行）— 完整技术参考，**新人必读**。20 章覆盖：架构、端口、文件布局、服务生命周期、License 系统、认证、TG 集成、安装包、`.env` 加载链（vmfix24/25 关键易错点）、SeedPack、安全模型、构建流程、vmfix15-25 全部修复历史、快速排查手册。
2. **`CLAUDE.md`** 第七节 — 项目高层进度
3. 本文件

---

## 1. 当前最新状态 (HEAD)

```
HEAD = b901695 (fix(dev-tools): Create-Shortcuts.ps1 — rename $Args param to avoid shadow)
分支 main，已 push GitHub
```

**最新 ship-ready 安装包**：

| 项 | 值 |
|---|---|
| 文件 | `installer/Output/TeleHubX-Setup-1.0.0-vmfix25.exe` |
| 大小 | 145.1 MB（主包内含 SeedPack） |
| **SHA256** | `324a1094cf5fb6109583f21e5854ef945640b24b2db0ca81c0bc09d2f7aaf423` |
| commit | `23eec7e`（vmfix25）|
| 状态 | **已 push，等 Bryan 在干净测试机上跑端到端 acceptance** |

---

## 2. 本轮关键交付（最新 → 最旧）

| Commit | vmfix | 说明 |
|---|---|---|
| `b901695` | — | `Create-Shortcuts.ps1` `$Args` 自动变量陷阱修复（**dev only**，不影响租户）|
| `db5ba41` | — | **新增 `工程技术蓝图.md`**（1274 行，完整技术文档）|
| `23eec7e` | vmfix25 | **Inno Setup wizard 装包时收 TG API**（根治弹窗+重启竞态）+ Settings 页编辑入口 |
| `4c2baed` | vmfix24 | `.env` 写所有候选路径 + 5 分钟超时 + ad-faq ADMIN access |
| `0a9febc` | vmfix23 | 自助 TG API setup modal + 后端 PlatformSettings + bind 503 结构化错误 |
| `f21d9fd` | vmfix22 | **合并 SeedPack 进主包** + `/activate` route redirect 修复 |
| `cf59cd8` | vmfix21 | postmaster.pid race + SeedPack stop/start race + 孤儿 postgres 清理 |
| `e517f89` | vmfix20 | sc sdset + Auto-start + 第三个快捷方式 + builtin 素材扫盘 + SeedPack 独立包 |
| `086f183` | vmfix18 | LicensePage 表单常驻 + HTA 启动加载窗 |
| `13ad1de` | vmfix16 | dashboard 反向代理（解决 405）|
| `74b7e18` | vmfix15 | LicensePage `effectiveStatus='unknown'` 白屏修复 |

详见 `工程技术蓝图.md` 第 19 章「已知问题与未来工作」。

---

## 3. 单租户部署当前状态（**ship-ready 评估**）

### ✅ 可以发租户的

| 验证项 | 状态 |
|--------|------|
| 干净 Win11 装 vmfix25 + 服务自启 | ✅ 已验（test 机 + dev 机）|
| 浏览器自动打开 dashboard | ✅ HTA 启动窗自关后开 |
| License 激活（cloud-license.bin） | ✅ vmfix17 `provisionLocalUser` 联通 |
| 用 email + password 登录 dashboard | ✅ |
| 装包 wizard 收 TG API（vmfix25）| ✅ Pascal wizard + WriteEnvField + ssPostInstall 写盘 |
| 绑 TG 账号 → Send OTP | ⚠️ **依赖租户填了 TG API**（vmfix25 wizard 已问）|
| 内置 322 素材 + 80 剧本 | ✅ vmfix22 主包内嵌 + onModuleInit 扫盘 |
| 重启 Windows 后服务自启 | ✅ vmfix20 startmode=Automatic + delayedAutoStart |
| 非 admin 用户用桌面 Stop/Start | ✅ vmfix20 sc sdset Authenticated Users |
| 知识库新建 KB | ✅ vmfix20 `provisionLocalUser` + `resolveTenantId` 注入 |
| 素材库 → 广告话术 | ✅ vmfix24 ad-faq @Roles 改 ADMIN |

### ⚠️ 还没实测但代码逻辑应该过的

| 验证项 | 备注 |
|--------|------|
| 真实 TG 账号绑定（带 2FA）| Bryan 没真用 TG OTP 绑过号 |
| Campaign 创建 + 执行 | 没跑过 |
| ChatScript 真在群里执行 | 没跑过 |
| Warmup P0-P4 真跑 | 没跑过 |
| Bot Gateway 客服 AI 回复 | 没跑过 |
| Lead Collection 派发到 leads 表 | agent → server callback 没验 |
| Takeover 真接管 | 没验 |
| Uninstall（删数据 vs 保留数据）| 没验 |

### ❌ 已知未做（Phase 6 / 配置 / 分发层）

| 项 | 影响 | 优先级 |
|---|------|---|
| **代码签名 EV 证书** | 租户撞 Chrome SmartScreen + Windows SmartScreen 警告 | **ship 必做**（~$300/年）|
| TypeORM migrations | 生产环境 `synchronize: true` 是数据风险 | **生产前必做** |
| schema-per-tenant | 当前单 schema 多租户 | 50+ 租户时 |
| 每租户独立 TG api_id 池 | 当前所有租户共享一对 | 5+ 租户时 |
| JWT 路由守卫覆盖率 | 个别端点 @Public 没设对 | 中 |
| agent 端 AI 调用走 effectiveAiConfig | BotGateway 已切，cs MTProto 没切 | 中 |

---

## 4. 测试机状态

### Bryan 的「老测试机」（被 vmfix15→25 多轮污染）

| 状态 | 备注 |
|------|------|
| 装的版本 | vmfix24（最后用的）|
| Tenant: StarBright2 | starbright2@gmail.com / Lailai222@ |
| License Key | 不记 |
| 状态 | 已激活，可登录，**TG API 已配** (`TG_API_ID=39667656` `TG_API_HASH=16d13452eb21a3d8e425d1a58d602b85`) |
| ⚠️ 本机不能再做 ship-ready acceptance | 5+ 轮 install/uninstall 状态污染 |

### 「干净测试机」（计划中）

Bryan 提过有第二台 Win11 但没上手。如果新 session 要做 ship-ready acceptance：
- **要么**：让 Bryan 上第二台干净 Win11
- **要么**：当前测试机彻底卸 + **手动删 `C:\ProgramData\TeleHubX`** + 重启 → 等于干净

---

## 5. 关键技术地雷（务必记住，否则会再次踩坑）

### 5.1 `.env` 加载候选先到先得（**vmfix24/25 关键修复**）

`installer/tools/src/shared/env.ts` `loadSupervisorEnv()` 按顺序读：

```
1. <dataDir>\secrets\local-secrets.env       (auto-gen JWT_SECRET 等)
2. %APPDATA%\TeleHubX\.env                    ← LocalService userEnv（vmfix24 之前的坑）
3. <dataDir>\..\.env                          ← C:\ProgramData\TeleHubX\.env
4. <installPath>\.env
5. <installPath>\.env.template
```

**先到先得**：候选 #2 已读到一个 key（即使是空字符串），后续候选**不会覆盖**。

LocalService 的 `%APPDATA%` = `C:\Windows\ServiceProfiles\LocalService\AppData\Roaming` —— 普通用户/非 elevated PS 没权限读。`bootstrapUserEnv()` 第一次启动时从模板拷过来。

**vmfix24** `PlatformSettingsService.saveTgApiAndRestart` 写**所有**候选路径。
**vmfix25** Inno Setup wizard 装包时直接写 `%ProgramData%\TeleHubX\.env` + `{app}\.env.template`（让 bootstrapUserEnv 拷模板时也带正确值）。

### 5.2 postgres 不能在带 admin token 的进程下启动

postgres v16 的 `pgwin32_is_admin()` 检查 `BUILTIN\Administrators` 成员资格，是就直接 exit 1。

修法（vmfix19）：supervisor 通过 `pg_ctl start` 启动 postgres（pg_ctl 自带 `CreateRestrictedToken` 剥 admin）。**不能直接 `spawn(postgres.exe)`**。

### 5.3 PowerShell 函数 `$Args` 是自动变量

不要用 `$Args` 作 param 名（会被屏蔽，永远拿不到传入值）。用 `$ArgList` 之类。

### 5.4 Inno Setup 的 `{` 是常量解析符

`[Run]` Parameters 里的 PowerShell 脚本含 `{` 会被 Inno 解析。要么转义 `{{`，要么改用不带 `{}` 的 cmd 写法。vmfix21 SeedPack 把 PS poll 循环改成 3 步 `sc stop / timeout / sc start`。

### 5.5 SeedPack `sc stop + sc start` race

vmfix20 留下的坑：sc start 太快，老 supervisor 还没释放。vmfix21 加 10s `timeout`。
vmfix22 直接合并 SeedPack 进主包，**根本不需要 stop/start**，race 消失。

### 5.6 LocalService 在 Session 0，`openBrowser` 实际无可见效果

supervisor 的 `openBrowser()` 调 rundll32，但 LocalService 在 Session 0 没桌面，浏览器实际没开。**真正可见的 browser-open 是 .vbs 在用户 session 跑的那一份**（vmfix18 splash）。

### 5.7 OneDrive 桌面不是默认 Desktop

Bryan dev 机 `[System.Environment]::GetFolderPath('Desktop')` 返回 `C:\Users\MSI\OneDrive\Desktop`，不是 `$env:USERPROFILE\Desktop`。新 session 排查桌面快捷方式时要查两个路径。

### 5.8 wscript.exe 没参数 = 弹 Settings 对话框

不是错误，是默认行为。如果租户报「双击桌面快捷方式弹设置框」，说明 .lnk Arguments 字段是空的（参考 5.3）。

---

## 6. 接下来可以做的事（优先级排序）

### P0 — 真正发租户前必做

1. **干净机器跑完整 acceptance test**（Path A 1-18 + Path B 1-8，见 issue #30 描述）
2. **代码签名证书**（EV，~$300/年）→ 解决 SmartScreen + Chrome 警告

### P1 — 大概率近期会撞

3. **TypeORM migrations**：替换 `synchronize: true`。当前生产数据风险 — schema 改动会强制 alter table，可能丢数据
4. **Bot Gateway** 在真实 TG bot 上验客服流程
5. **Campaign 创建 + 执行** 跑真实任务，看 agent 那边 GramJS 调用是否正常
6. **uninstall** 流程验证（带数据删除选项）
7. **重启 Windows 后服务自启** 实测一遍

### P2 — 体验改进

8. agent TG_API_ID 空时不退出，改成 log warning 后等待轮询。这样改完不重启服务也能立刻生效
9. Init-pgdata warm pgdata 也要 2 分钟太慢，优化 pg_ctl 重试逻辑
10. stop.exe `exe_outside_install` 警告 cosmetic 清理
11. supervisor.log 噪音清理（"bootstrap lock 334s old" 等）

### P3 — 长期

12. Phase 6: schema-per-tenant + 多租户 api_id 池

---

## 7. 新 session 接手时的常见操作

### 7.1 出新 vmfix26+

```powershell
# 1. 改代码
# 2. 验证 server 编译
cd "C:\AI_WORKSPACE\Telegram Auto Bot"
pnpm --filter @telehubx/server build
pnpm --filter @telehubx/dashboard build

# 3. 改版本号（两处必须同步）
#    installer/build-dist.cjs   - VERSION.txt 内容 + artifact 名
#    installer/telehubx.iss     - OutputBaseFilename

# 4. build 安装包（约 6 分钟）
powershell -NoProfile -ExecutionPolicy Bypass -File installer\build.ps1

# 5. 计算 SHA256
powershell -Command "(Get-FileHash 'installer\Output\TeleHubX-Setup-1.0.0-vmfix26.exe' -Algorithm SHA256).Hash.ToLower()"

# 6. commit + push
git add ... && git commit -m "..." && git push origin main

# 7. 新建 GitHub issue 跟踪
gh issue create --repo bryangeh79/TeleHubX --title "..." --body "..."
```

### 7.2 测试机诊断（Codex 在测试机上）

测试机有 Codex MCP / Claude Code。新 session 写 PowerShell 诊断片段交给 Bryan，Bryan 让 Codex 跑，结果回贴。**Codex 默认非 elevated**，需要 elevated 操作时让 Codex 用 `Start-Process powershell -Verb RunAs` 触发 UAC（参考 issue #26 round 2 做法）。

### 7.3 已建 GitHub Issues 索引

| # | 标题 | 状态 |
|---|------|------|
| 22 | vmfix14 dashboard white screen | closed via vmfix15 |
| 23 | vmfix15 License activation 405 | closed via vmfix16 |
| 24 | vmfix16 License activated but /login rejects | closed via vmfix17 |
| 25 | vmfix17 .vbs opens supervisor.log on cold first install | closed via vmfix18 |
| 26 | vmfix18 postgres exit 1 / 16ms (admin-token check) | closed via vmfix19 |
| 27 | vmfix20 ship-ready (auto-start + sc ACL + Dashboard shortcut + seed scanners) | superseded by #28 |
| 28 | vmfix22 unified installer | superseded by #30 |
| 29 | vmfix23 self-service TG API setup modal | followup in vmfix24/25 |
| 30 | vmfix25 collect TG API at install time | open（待 acceptance） |

---

## 8. 文件索引（开发者备查）

| 用途 | 路径 |
|------|------|
| **完整技术参考** | `工程技术蓝图.md` |
| Project context | `CLAUDE.md` |
| supervisor 主逻辑 | `installer/tools/src/supervisor.ts` |
| .env 加载链 | `installer/tools/src/shared/env.ts` |
| 安装脚本（Pascal wizard）| `installer/telehubx.iss` |
| WinSW 服务配置 | `installer/runtime/winsw/telehubx-service.xml` |
| HTA 加载窗 | `installer/runtime/launcher/telehubx-loading.hta` |
| Build 入口 | `installer/build.ps1` + `installer/build-dist.cjs` |
| SeedPack staging | `installer/seedpack/build-seedpack.ps1` |
| Cloud License Service | `apps/server/src/cloud-license/cloud-license.service.ts` |
| Auth Service | `apps/server/src/auth/auth.service.ts` |
| Bind Service | `apps/server/src/accounts/bind/bind.service.ts` |
| Platform Settings (TG API) | `apps/server/src/admin/platform-settings.service.ts` |
| Asset Scanner | `apps/server/src/assets/assets.service.ts`（onModuleInit）|
| ChatScript Importer | `apps/server/src/chat-scripts/chat-scripts.service.ts`（onModuleInit）|
| LicensePage | `apps/dashboard/src/pages/license/LicensePage.tsx` |
| BindWizard | `apps/dashboard/src/pages/accounts/BindWizard.tsx` |
| TgApiSetupModal | `apps/dashboard/src/components/TgApiSetupModal.tsx` |
| TgApiPage（Settings 编辑）| `apps/dashboard/src/pages/settings/TgApiPage.tsx` |

---

## 9. 给新 Claude session 的开场建议

1. **先读 `工程技术蓝图.md`**（最完整）
2. **再读 CLAUDE.md 第七节**（高层进度）
3. **再读本文件**（最近一轮修复 + 地雷）
4. WAhubX 路径 `C:\AI_WORKSPACE\Whatsapp Auto Bot`，**只读不写**
5. 默认行为：等 Bryan 报 bug 或定方向。**不要主动重做已修过的事**。
6. **不要混淆**：
   - 安装包用的快捷方式（Inno Setup [Icons] 生成）vs dev 机用的快捷方式（`Create-Shortcuts.ps1` 生成）
   - 装包内嵌 SeedPack（vmfix22+）vs 独立 SeedPack-only 包（vmfix20-21 时代，已废弃但代码还在）
   - cloud-license（`/settings/license` 是 vmfix15-25 用的）vs 老 local-license（`/activate` 是 ActivatePage，已 deprecated 路由 redirect）

### 端口速查

| 服务 | 端口 |
|------|------|
| Backend (NestJS) | **9800** |
| Dashboard (Vite/serve.cjs) | **9601** |
| PostgreSQL | **5436** |
| Redis | **6386** |

### 常用命令

```powershell
cd "C:\AI_WORKSPACE\Telegram Auto Bot"

# Build
powershell installer\build.ps1

# Service 管理
sc.exe query TeleHubX
sc.exe start TeleHubX
sc.exe stop TeleHubX

# 日志
Get-Content "C:\ProgramData\TeleHubX\data\logs\supervisor.log" -Tail 50
Get-Content "C:\ProgramData\TeleHubX\data\logs\server.log" -Tail 50

# Hard reset（如果 service 卡住）
sc.exe stop TeleHubX
taskkill /F /IM postgres.exe 2>$null
taskkill /F /IM redis-server.exe 2>$null
taskkill /F /IM telehubx-supervisor.exe 2>$null
Remove-Item "C:\ProgramData\TeleHubX\data\run\*.pid" -EA 0
Remove-Item "C:\ProgramData\TeleHubX\data\run\supervisor.lock" -EA 0
sc.exe start TeleHubX
```

---

## 10. Bryan 的工作偏好（重要）

- **不要主动创建 *.md 文档**（除非他明确要求 — 工程蓝图是他要求的）
- **不要写 emoji 进文件**（除非他要求）
- **commit 信息中文/英文都可**，按 WAhubX 风格
- 编辑 `telehubx_*.md` 后要 push GitHub
- 桌面快捷方式 / 用户 UX 类问题他会很在意（vmfix20 加第三个快捷方式、vmfix25 wizard 收 TG API 都是他主动提的）
- **Auto mode**：他喜欢明确指令时立刻执行，不喜欢过度规划。但**复杂决策**（架构 / 安装包结构）他会要 plan 再批
- **承诺要兑现**：「全过了 = ship-ready」是他的验收标准，不能用「代码看着对」糊弄过去

---

> 本文档每轮 vmfix 后更新。如出 vmfix26+ 请同步：
> - 章节 2「本轮关键交付」加新 commit
> - 章节 3「ship-ready 评估」如果项变状态
> - 章节 5「技术地雷」如有新坑
> - 章节 7.3 「GitHub Issues 索引」
