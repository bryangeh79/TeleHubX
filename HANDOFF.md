# TeleHubX — Handoff Doc

> 交接时间: 2026-04-30 02:08 GMT+8 (Captain) → 03:15 GMT+8 (CC debug pass)  
> 当前状态: 后端 21/21 回归通过 + Dashboard 首屏修复，可演示  
> 项目根: `C:\AI_WORKSPACE\Telegram Auto Bot`  
> GitHub: `https://github.com/bryangeh79/TeleHubX`

---

## CC Debug Pass 修复摘要 (2026-04-30 03:15)

| Bug | 修法 |
|---|---|
| 非 UUID `:id` → 500 | 全控制器 `ParseUUIDPipe` + 全局 `QueryFailedExceptionFilter` |
| 重复 phoneNumber → 500 | 同上 filter (PG 23505 → 409) |
| API 泄漏 `sessionString` | `@Exclude({toPlainOnly:true})` + 全局 `ClassSerializerInterceptor` |
| `PATCH` 响应字段缺失 | service.update 改为 save 后 `findOne()` 重读 |
| AI 模块 invalid key → 500 | `ensureConfigured()` 守门 + `translateUpstreamError()` 映射上游错误为 503/502 |
| Dashboard 首屏 import error | 创建 `components/DashboardLayout.tsx` |
| Dashboard API 三处方法缺失 | `services/api.ts` 补 `warmupApi.pause` / `leadsApi.reply` / `statsApi.overview` |
| Dashboard warmup URL 错 | 改为 `/accounts/:id/warmup/start` 等正确路径 |

---

## 1. 运行状态

| 服务 | 端口 | 进程管理 | 状态 |
|------|------|----------|------|
| Backend (NestJS) | 9600 | pm2 (telehubx-server) | ✅ online |
| Dashboard (Vite) | 9601 | pm2 (telehubx-dashboard) | ✅ online |
| PostgreSQL | 5436 | 本地服务 | ✅ connected |
| Redis | 6386 | 本地服务 | ✅ connected |

快速查看：`pm2 list`  
实时日志：`pm2 logs telehubx-server`  
健康检查：`http://localhost:9600/api/v1/health`

---

## 2. 项目结构

```
telehubx/
├── apps/
│   ├── server/          # NestJS 后端 (41 TS files)
│   │   └── src/
│   │       ├── accounts/    # 账号 CRUD + warmup + import + security
│   │       ├── campaigns/   # 活动 CRUD + send
│   │       ├── leads/       # 线索 CRUD + assign + note
│   │       ├── ai-agent/    # OpenAI 集成 + Redis 上下文
│   │       ├── crypto/      # AES-256-GCM session 加密
│   │       ├── logger/      # Winston + DailyRotateFile
│   │       └── redis/       # Redis provider
│   ├── agent/           # GramJS 代理层 (15 TS files)
│   │   └── src/
│   │       ├── telegram/    # 连接工厂 + 消息处理 + 发送 + keeponline
│   │       ├── warmup/      # Phase 0-4 暖号控制
│   │       ├── campaign/    # 活动执行器 (1msg/5s 限速)
│   │       ├── ai/          # OpenAI 模板 + 上下文存储
│   │       ├── security/    # 验证码回调
│   │       ├── logger.ts
│   │       └── shutdown.ts
│   └── dashboard/       # React + Ant Design 前端 (13 TS/TSX files)
│       └── src/
│           ├── pages/
│           │   ├── accounts/    # AccountsPage + BindWizard + Import
│           │   ├── warmup/      # WarmupPage
│           │   ├── campaigns/   # CampaignsPage + CampaignForm
│           │   ├── leads/       # LeadsInbox
│           │   ├── ai/          # AiSettingsPage
│           │   └── DashboardPage.tsx
│           └── services/api.ts  # Axios wrapper
├── ecosystem.config.cjs  # pm2 配置
├── Start-TeleHubX.bat    # 双击启动
├── installer.iss         # Inno Setup 打包脚本
└── pnpm-workspace.yaml   # Monorepo 配置
```

---

## 3. API 清单 (42 routes)

### Health
- `GET /api/v1/health`

### Accounts (`/api/v1/accounts`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | 创建账号 |
| GET | `/` | 列表 (query: role, status) |
| GET | `/health-stats` | 聚合统计 (total/avgHealth/byStatus) |
| POST | `/import` | JSON 批量导入 |
| POST | `/import-csv` | CSV 字符串批量导入 |
| GET | `/:id` | 获取详情 |
| PATCH | `/:id` | 更新 (role/status/proxyConfig/healthScore) |
| DELETE | `/:id` | 删除 |
| POST | `/:id/session` | 更新 session string |
| GET | `/:id/session/raw` | 获取解密后 session |
| POST | `/:id/health` | 报告健康分 (body: healthScore, remark) |
| POST | `/:id/heartbeat` | 心跳上报 |
| POST | `/:id/bind-ip` | IP 绑定 |
| POST | `/:id/warmup/start` | 启动暖号 (Phase 0) |
| POST | `/:id/warmup/advance` | 推进暖号阶段 |
| POST | `/:id/warmup/pause` | 暂停暖号 |
| POST | `/:id/warmup/resume` | 恢复暖号 |
| GET | `/:id/warmup` | 暖号状态 |
| POST | `/:id/bind/init` | 触发 Telegram OTP（BindWizard 第 1 步）|
| POST | `/:id/bind/verify` | 提交 OTP（+ 可选 2FA 密码）完成绑定 |
| POST | `/:id/bind/cancel` | 取消进行中的 bind 会话 |

### Campaigns (`/api/v1/campaigns`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | 创建活动 |
| GET | `/` | 列表 (query: status) |
| GET | `/:id` | 获取详情 |
| PATCH | `/:id` | 更新 |
| DELETE | `/:id` | 删除 |
| POST | `/:id/send` | 投放活动 |

### Leads (`/api/v1/leads`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | 创建线索 |
| GET | `/` | 列表 (query: status, intent, needsHuman) |
| GET | `/:id` | 获取详情 |
| POST | `/:id/assign` | 分配 CS 账号 |
| POST | `/:id/note` | 添加跟进备注 |
| POST | `/:id/reply` | 客服回复（写 audit + 状态→in_progress） |
| DELETE | `/:id` | 删除 |

### AI (`/api/v1/ai`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/info` | 列出 3 个 provider 是否已配置 + 默认 provider |
| POST | `/reply` | 自动回复 (body: chatId, userMessage, **provider?**, **model?**) |
| POST | `/faq` | FAQ 快速回答 (body: question, **provider?**, **model?**) |
| DELETE | `/conversation/:chatId` | 清除对话历史 |

支持 `provider`：`openai` / `deepseek` / `gemini`（三家共用 OpenAI SDK，`baseURL` 切换）。
默认 provider 由 `AI_PROVIDER` env 决定（fallback `openai`）。每次请求可用 body 里 `provider` / `model` 临时覆盖。

---

## 3.1 DTO 字段契约（必须严格按这个发请求）

> 全局 `ValidationPipe` 开了 `whitelist + forbidNonWhitelisted`，多/错字段直接 400。

### POST `/accounts`
```json
{
  "phoneNumber": "+60123456789",       // required
  "role": "cs",                         // "cs" | "ad" | "hybrid"，默认 cs
  "proxyConfig": { "host": "...", "port": 1080 } // optional
}
```

### POST `/campaigns`
```json
{
  "name": "Spring Promo",                                  // required
  "type": "broadcast",                                     // "broadcast" | "sequential" — 不接受 "private"
  "targets": ["@user1", "@user2"],                         // string[]
  "messageVariants": [{"text": "你好"}, {"text": "Hi"}],   // 必须是 {text, mediaUrl?} 对象，不是字符串
  "description": "...",                                    // optional
  "scheduledAt": "2026-05-01T10:00:00Z"                    // optional ISO8601
}
```

### POST `/leads`
```json
{
  "tgUserId": "123456789",       // required (NOT `telegramUserId`)
  "tgUsername": "buyer",          // optional (NOT `telegramUsername` / `displayName`)
  "campaignId": "<uuid>",         // optional (NOT `campaignName`)
  "product": "Pro Plan",          // optional
  "budget": "500+",               // optional
  "intent": "hot",                // "cold" | "warm" | "hot"
  "needsHuman": true              // optional
}
```

### POST `/leads/:id/assign`
```json
{ "csAccountId": "<uuid>" }       // NOT `assignedTo`
```

### POST `/leads/:id/note`
```json
{ "note": "follow up tomorrow" }
```

### POST `/leads/:id/reply`
```json
{ "text": "thanks for reaching out, can we schedule a call?" }
```

### POST `/accounts/:id/bind/init`
```json
{ "phone": "+60123456789" }
```
返回 `{phoneCodeHash, expiresIn, codeType}`。Telegram 立刻给该手机的官方 Telegram App 发 OTP（不是 SMS，除非该手机没装 app）。`phoneCodeHash` 客户端不用管，server 端记在内存里 5 分钟。

### POST `/accounts/:id/bind/verify`
```json
// 第一次提交 OTP
{ "code": "12345" }

// 如果上一步返回了 needsPassword:true，再提交一次带 2FA 密码
{ "code": "12345", "password": "your-cloud-pw" }
```

返回有两种形态：

**需要 2FA**：
```json
{ "ok": false, "needsPassword": true, "hint": "可选，TG 给的密码提示" }
```

**绑定成功**：
```json
{
  "ok": true, "needsPassword": false,
  "user": { "id": "12345678", "username": "bg19", "firstName": "BG", "phone": "60xxxx" }
}
```
session string 已加密存进 `accounts.session_string`，**不会**通过响应返回。

### POST `/accounts/:id/bind/cancel`
```json
// no body
```
返回 `{ok: true, cancelled: <bool>}`。把 server 端 in-memory 的 GramJS client disconnect 并清掉。幂等 — 没在进行中的 bind 也返回 `cancelled:false`。
追加到 `lead.replies[]`（`{text, sentBy:'human', ts}`）；若 lead 不在 `converted`/`closed`，状态更新为 `in_progress`。**当前是数据层 audit，不会真去 Telegram 发；后续 agent 拨号时再绑发送。**

### POST `/accounts/:id/bind-ip`
```json
{ "ip": "203.0.113.7" }
```

### POST `/accounts/:id/health`
```json
{ "healthScore": 85, "remark": "smoke test" }
```

### POST `/ai/reply` / `/ai/faq`
```json
// reply
{
  "chatId": "user-1",
  "userMessage": "你好",
  "systemPrompt": "可选",
  "provider": "deepseek",          // 可选：openai | deepseek | gemini
  "model": "deepseek-chat"          // 可选：覆盖默认 model
}
// faq
{ "question": "How much?", "context": "可选", "provider": "gemini" }
```
返回会附带实际使用的 provider/model：`{ reply, tokens, provider, model }`。

### GET `/ai/info`
```json
{
  "defaultProvider": "openai",
  "providers": [
    { "id": "openai",   "label": "OpenAI",        "configured": true,  "keyEnv": "OPENAI_API_KEY",   "defaultModel": "gpt-4o-mini" },
    { "id": "deepseek", "label": "DeepSeek",      "configured": false, "keyEnv": "DEEPSEEK_API_KEY", "defaultModel": "deepseek-chat" },
    { "id": "gemini",   "label": "Google Gemini", "configured": true,  "keyEnv": "GEMINI_API_KEY",   "defaultModel": "gemini-2.0-flash" }
  ]
}
```

### 错误码对照
| 场景 | HTTP | Body |
|---|---|---|
| 必填字段缺失 / 枚举非法 | 400 | `class-validator` message[] |
| `:id` 非 UUID 格式 | 400 | `Validation failed (uuid is expected)` |
| `:id` UUID 格式但记录不存在 | 404 | `<Resource> <id> not found` |
| 重复 `phoneNumber` | 409 | PG detail message |
| Warmup 已启动后再 `start` | 409 | `Warmup already started for account ...` |
| 多余字段 | 400 | `property X should not exist` |
| AI key 缺失 / 无效 | 503 | `AI provider not configured / authentication failed` |
| AI 上游错误 (5xx, network) | 502 | `AI provider returned an error` |

---

## 4. 环境变量 (.env)

```
NODE_ENV=development
APP_PORT=9600
DB_HOST=localhost
DB_PORT=5436              # moved from 5433 (FAhubX took it back)
DB_USER=telehubx
DB_PASSWORD=telehubx
DB_NAME=telehubx
DB_LOGGING=false
REDIS_HOST=localhost
REDIS_PORT=6386           # moved from 6380 (FAhubX took it back)
# 可选 — 不设置时 AI 模块返回 503，不会崩
SESSION_ENCRYPTION_KEY=your-32-char-secret
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
LOG_LEVEL=info
```

> 当前实际 `.env` **没有** AI keys，但进程从 Windows 系统环境继承到 `OPENAI_API_KEY`（invalid）和 `GEMINI_API_KEY`（quota exceeded）。AI 接口因此返回 503 + 清晰消息。要恢复正常：
> ```powershell
> setx AI_PROVIDER deepseek                  # 选默认 provider
> setx DEEPSEEK_API_KEY sk-...                # 配 provider 对应的 key
> pm2 restart telehubx-server
> ```

### AI 多 Provider env vars
```
AI_PROVIDER=openai            # openai | deepseek | gemini，默认 openai
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
GEMINI_API_KEY=...
AI_API_KEY=                   # 备选通用 key（当 provider 专属 key 没设时回退到这个）
AI_MODEL=                     # 全局覆盖 model（不设则用 provider 默认）
AI_BASE_URL=                  # 全局覆盖 baseURL（不设则用 provider 标准）
```
三家都用 OpenAI Chat Completions wire 协议，所以单一 `openai` SDK 足够（DeepSeek 直接兼容；Gemini 走 Google 官方 OpenAI-compat shim）。

---

## 5. 已知限制 / 待办

### ⚠️ 代码层面（已修复，留档）
1. ~~No API key → 500~~ → **已修**：返回 503 + 清晰消息（"AI provider not configured / authentication failed"）
2. **Warmup 不能重复启动**：保持 409 Conflict 设计
3. ~~Dashboard 不编译~~ → **已修**：缺失的 `DashboardLayout` 组件已建，api.ts 已补齐 `warmupApi.pause` / `leadsApi.reply` / `statsApi.overview` 并修正 warmup URL

### ⚠️ 仍未做的
1. ~~Backend 暂无 warmup pause / lead reply~~ → **已补**
2. ~~Dashboard 生产 build 没验证过~~ → **已验证**
3. ~~AI 路径只有 OpenAI~~ → **已补**
4. ~~BindWizard 是空 placeholder~~ → **已补**（B1）：dashboard 3 步向导（Setup → Verify → Done），server 端 `/bind/init` + `/bind/verify` + `/bind/cancel` 三端点，2FA 自动 fallback
5. **Lead reply 是数据层 audit**：写 `lead.replies[]` + 切 `in_progress`，**没有真发到 Telegram**。等 agent 拨号工人接入后才能形成完整闭环
6. **Agent 不会自动发现 BindWizard 新绑的账号**：bind 完后 session 进 DB，但 agent 启动时只读 `.env` 里的 `TG_SESSION`。要让 agent 多账号热加载需要：(a) agent 启动时 `SELECT * FROM accounts WHERE session_encrypted=true` 全部连，或 (b) server → agent 推送 "new account ready" 事件。两者都属于 C2 / 多账号编排范畴
7. **Schema 变更需手动 SQL**：`pm2` 跑 `dist/main.js` 且 ecosystem 强制 `NODE_ENV=production`，TypeORM `synchronize` 关闭。新增列必须手动 `ALTER TABLE`。生产应改用 typeorm migrations
8. **Anthropic Claude 没列在 provider 里**：和 GPT/DeepSeek/Gemini 不同，Claude wire 协议不兼容 OpenAI Chat Completions，不能共用一个 SDK。要支持得加 `@anthropic-ai/sdk` 依赖 + 第二份 client 实现

### 📦 部署
1. **Inno Setup 打包**: 脚本 `installer.iss` 写好了，需安装 Inno Setup 6 后运行 `ISCC.exe installer.iss` 生成 .exe
2. **开机自启**: 目前 `pm2 save` 已存快照，但需要 `pm2 startup` 注册系统服务
3. **Dashboard 生产 build**: 改成 nginx/静态文件提供比 Vite dev server 更稳定

---

## 6. 交接给 CC 的测试建议

### 优先级 1 — 前端验证
- `http://localhost:9601` 打开 Dashboard
- 确认所有页面路由正常（accounts/ warmup/ campaigns/ leads/ ai）
- 点击 "New Account" → BindWizard 3 步骤是否流畅
- CSV 导入页面拖拽文件是否可用
- LeadsInbox 双面板消息 UI

### 优先级 2 — API 核心流
```powershell
# 创建账号 → 开始暖号 → 创建活动 → 投放 → 创建线索 → 分配 → 添加备注
Invoke-RestMethod http://localhost:9600/api/v1/health
```

### 优先级 3 — 边界测试
- 传空手机号 → 400
- 传不存在的 ID → 404
- 传不存在的 role → 400
- IP 绑定后再次绑定 → 覆盖
- 删除账号后查询 → 404

### 优先级 4 — Agent 代码审查
- `apps/agent/` 的代码没跑过 `tsc --noEmit`，可能有关联问题
- GramJS 需要真实 Telegram 账号才能测试连接

### 优先级 5 — 打包
- 安装 Inno Setup 6 → `ISCC.exe installer.iss`
- 注册 pm2 开机启动: `pm2 startup` → 按提示执行命令

---

## 7. 快速启动命令

```powershell
# 开发
cd C:\AI_WORKSPACE\Telegram Auto Bot
pnpm --filter @telehubx/server start
pnpm --filter @telehubx/dashboard dev

# 生产 (pm2)
pm2 start ecosystem.config.cjs
pm2 save

# 构建
pnpm --filter @telehubx/server build

# 一键启动
双击 Start-TeleHubX.bat
```

---

*Captain sign-off: 2026-04-30 02:08 GMT+8 — P1-P6 代码 100%, API 15/15 全绿, 准备交接给 CC 接手测试阶段。*

*CC sign-off: 2026-04-30 03:15 GMT+8 — Debug pass complete: 5 backend bugs (P0/P1) + 3 dashboard bugs fixed; 21/21 regression green; tsc --noEmit clean on server/agent/dashboard.*

*CC follow-up: 2026-04-30 03:30 GMT+8 — Filled gaps surfaced during debug: dashboard prod build validated; new endpoints `POST /accounts/:id/warmup/{pause,resume}` and `POST /leads/:id/reply`; lead replies audit column added; dead `health/` subdir removed; `example.env` updated to match runtime config; 13/13 new-endpoint smoke + 3/3 regression green.*

*CC follow-up #2: 2026-04-30 03:45 GMT+8 — AI multi-provider abstraction landed. Single `openai` SDK serves three providers (openai / deepseek / gemini) via baseURL switching; provider chosen by `AI_PROVIDER` env or per-request `provider` field in DTO; new `GET /ai/info` exposes configured-state matrix. Verified end-to-end: gemini routing literally reaches Google's API (logs show `provider=gemini status=429`). 9/10 smoke + 4/4 regression green; tsc + nest build clean. Claude not included — it doesn't speak OpenAI wire protocol natively.*

*CC follow-up #3: 2026-04-30 04:30 GMT+8 — Real-account end-to-end validation. Built one-shot CLI login wizard at `apps/agent/scripts/login-wizard.ts` (tsx). User completed phone+OTP+2FA dance against a live Malaysian Telegram account; StringSession persisted to `.env`. Agent went online via pm2, connected to TG DC 91.108.56.155 LAYER 198, KeepOnline ticking. Inbound DM auto-divert to bot username + group @-mention FAQ reply both verified live. Confirmed `.env` was leaking into git tracking; fixed by extending `.gitignore` and `git rm --cached .env` (no secrets actually pushed yet — only project default DB creds were ever tracked).*

*CC follow-up #4: 2026-04-30 04:50 GMT+8 — B1 BindWizard. Server-side `BindOrchestratorService` (in-memory `accountId → TelegramClient` map, 5min TTL, GC every 60s) drives `auth.SendCode` / `auth.SignIn` / `auth.CheckPassword` for tenant-self-service account binding. Three new endpoints (`/bind/init`, `/bind/verify`, `/bind/cancel`) on `accounts` controller. Dashboard `BindWizard.tsx` rewritten as real 3-step UI (Setup → Verify → Done), with automatic 2FA gate, OTP resend, and rollback-on-error (deletes the account record if `/bind/init` fails). Boundary smoke green (10/10: phone format, missing fields, non-UUID id, missing account, verify-without-init, idempotent cancel, etc). Live-flow smoke deferred — would consume a real OTP on the user's phone.*

*Important sidefix: server's `ConfigModule` was loading `.env` at relative path `'.env'`, which under pm2 (cwd=`apps/server`) failed to find the project-root file. Only OPENAI_API_KEY was working because it's set as a Windows system env var. Changed to `envFilePath: ['../../.env', '.env']`. Now TG_API_ID / TG_API_HASH / DEEPSEEK_API_KEY / etc. flow correctly through ConfigService.*
