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
| Dashboard (Vite) | 3000 | pm2 (telehubx-dashboard) | ✅ online |
| PostgreSQL | 5433 | 本地服务 | ✅ connected |
| Redis | 6380 | 本地服务 | ✅ connected |

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
| GET | `/:id/warmup` | 暖号状态 |

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
| DELETE | `/:id` | 删除 |

### AI (`/api/v1/ai`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/reply` | 自动回复 (body: chatId, userMessage) |
| POST | `/faq` | FAQ 快速回答 (body: question) |
| DELETE | `/conversation/:chatId` | 清除对话历史 |

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
{ "chatId": "user-1", "userMessage": "你好", "systemPrompt": "可选" }
// faq
{ "question": "How much?", "context": "可选" }
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
DB_PORT=5433
DB_USER=telehubx
DB_PASSWORD=telehubx
DB_NAME=telehubx
DB_LOGGING=false
REDIS_HOST=localhost
REDIS_PORT=6380          # 注意：不是 6379
# 可选 — 不设置时 AI 模块返回 503，不会崩
SESSION_ENCRYPTION_KEY=your-32-char-secret
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
LOG_LEVEL=info
```

> 当前实际 `.env` **没有** `OPENAI_API_KEY`，但进程从 Windows 系统环境变量继承到了一个 invalid key（`sk-proj-...EsEA`）。AI 接口因此会返回 503 + 清晰错误信息。要恢复正常用 `setx OPENAI_API_KEY <valid-key>` 然后 `pm2 restart telehubx-server`。

---

## 5. 已知限制 / 待办

### ⚠️ 代码层面（已修复，留档）
1. ~~No API key → 500~~ → **已修**：返回 503 + 清晰消息（"AI provider not configured / authentication failed"）
2. **Warmup 不能重复启动**：保持 409 Conflict 设计
3. ~~Dashboard 不编译~~ → **已修**：缺失的 `DashboardLayout` 组件已建，api.ts 已补齐 `warmupApi.pause` / `leadsApi.reply` / `statsApi.overview` 并修正 warmup URL

### ⚠️ 仍未做的
1. **Backend 暂无 warmup pause / lead reply 接口** — 前端目前调用会 404，UI 层有 try/catch 和 mock 回退；后端日后补 `POST /accounts/:id/warmup/pause` 和 `POST /leads/:id/reply` 才能真正联动
2. **Dashboard 生产 build 没验证过**：`pnpm --filter @telehubx/dashboard build` 没跑过；目前只验证了 Vite dev server (`tsc --noEmit` 0 错)
3. **AI 路径只有 OpenAI**：DeepSeek/Gemini/Claude 的 Provider 抽象未建

### 📦 部署
1. **Inno Setup 打包**: 脚本 `installer.iss` 写好了，需安装 Inno Setup 6 后运行 `ISCC.exe installer.iss` 生成 .exe
2. **开机自启**: 目前 `pm2 save` 已存快照，但需要 `pm2 startup` 注册系统服务
3. **Dashboard 生产 build**: 改成 nginx/静态文件提供比 Vite dev server 更稳定

---

## 6. 交接给 CC 的测试建议

### 优先级 1 — 前端验证
- `http://localhost:3000` 打开 Dashboard
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
