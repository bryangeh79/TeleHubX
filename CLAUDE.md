# TeleHubX — 项目上下文（Claude Code 自动加载）

> 本文件用于让新启动的 Claude Code session 自动获得 TeleHubX 项目完整背景，无需重新解释即可继续推进工作。
> 上次更新：2026-04-30

---

## 一、项目身份

| 维度 | 值 |
|------|---|
| **项目名** | TeleHubX |
| **本地路径** | `C:\AI_WORKSPACE\Telegram Auto Bot` |
| **GitHub** | https://github.com/bryangeh79/TeleHubX |
| **当前分支** | main |
| **Git 用户** | bryangeh79 |
| **平台** | Windows 11 / bash + PowerShell |
| **定位** | Telegram 广告投放 + 多账号养号 + AI 智能客服 + 人工接管 + 线索收集 的 SaaS 系统 |
| **不是** | 单纯的 Telegram 群发器 |
| **核心商业逻辑** | 广告号引流 → 客服号成交 |
| **参考来源** | WAhubX (`C:\AI_WORKSPACE\Whatsapp Auto Bot`) — **只读不写**，借鉴架构经验 |

---

## 二、技术栈

| 层 | 选型 | 备注 |
|----|------|-----|
| 后端 | NestJS + TypeORM + PostgreSQL + Redis + BullMQ | 与 WAhubX 同栈 |
| TG 客户端库 | **GramJS (TypeScript)** + StringSession | 不用 TDLib/Telethon/Pyrogram |
| 客服入口 | **Bot API**（单一 Bot） | 低风险、无频率限制 |
| 广告/养号 | **MTProto Client (GramJS)** | 多账号、群组、私聊 |
| 容器 | Docker + `node:20-alpine` (~150MB) | 不含 Chromium |
| 代理 | SOCKS5 住宅/移动代理（每号绑死一个固定 IP） | 禁用 Datacenter Proxy |
| 设备指纹 | Samsung SM-S928B + Android 14 + Telegram 10.14.2 + 马来西亚住宅 IP | TG 看到"手机 App 登录" |
| License | Ed25519 签名 + Cloudflare Workers 验证 | 复用 WAhubX |
| 多租户 | schema-per-tenant (PostgreSQL) | 完全隔离 |
| 部署 | 轻 VPS (服务端编排) + 重客户端 (容器农场 + Runtime Agent) | WS 双向通信 |
| 前端 | React 18 + Vite + Ant Design 5 + React Query + Zustand + Socket.IO | 与 WAhubX 同栈 |
| 多语言 | react-i18next 架构预留，现阶段只挂载，不翻译 | i18n 后期实现 |

---

## 三、账户角色体系（核心创新）

| 角色 | 行为 |
|------|------|
| **客服号 (cs)** | AI 自动回复 + FAQ + 接管，被动等待客户 |
| **广告号 (ad)** | 关闭 AI；群组 FAQ 简短回复；私聊统一引流到 Bot；执行 Campaign / 剧本 / Warmup |
| **混合号 (hybrid)** | 高风险，需 Super Admin 显式覆盖才启用 |

---

## 四、六大核心模块

1. **Campaign 4 层架构** — 计划 → 素材 → 执行 → 归因。300/30 = 10 封/号，AI Variant 生成 N 种文案变体（句式/表情/标点/格式 + 图片微偏移），Gaussian 间隔。
2. **ChatScript 多角色剧本引擎** — A+B+C+D 多账号在群内模拟真实对话；群有真人活跃时跳过；冷场才执行；一天一群一次。
3. **Warmup P0-P4 渐进养号** — 7 天周期：初始化 → 沉默观察 → 轻微活动 → 社交建立 → 常规运营。所有动作 Gaussian 随机间隔。
4. **AI 智能回复** — 三档：关闭 / FAQ-only / AI Smart Reply。Provider: OpenAI / DeepSeek / Gemini / Claude / Custom OpenAI-Compat。tenant 级配置，**不写死代码**。
5. **Lead Collection** — 结构化字段：tg_username、campaign 归因、产品、规模、预算、意向 (cold/warm/hot)、是否需人工。支持 CSV 导出。**WAhubX 缺这个，TeleHubX 从 v1 补上。**
6. **Takeover 人工接管（修补 WAhubX 缺陷）** — 接管后 AI 立即停 + 广告任务跳过该客户 + 进入人工池 + 全程 audit。

### 知识库 7 类
产品资料 / 价格套餐 / 售前 FAQ / 售后 FAQ / 公司介绍 / 广告素材 / 风控禁答规则。复用 WAhubX RAG (pgvector)。Starter FAQ 用 `{tenantName}` / `{botName}` 占位符，**不硬编码产品名**。

---

## 五、群源策略

| 方式 | 用途 |
|------|------|
| 自建 2-3 个核心群 | 剧本表演、养号、客户沉淀 |
| 加别人群 | P4+ 成熟账号每天加 1-2 个，先观察 24h 再发言 |

---

## 六、反检测铁律

1. 一号一固定 IP，不轮换（TG Session+IP 绑定到 DC）
2. 广告号与客服号 IP 段不重叠
3. 变体文案相似度 < 70%
4. ChatScript 一天一群一次
5. 加别人群 ≤ 2/天/账号
6. 自建群只跑剧本，不日常用广告号
7. FloodWait 自动指数退避
8. Health Score 0-100：80+ 健康 / 60-80 黄（降频）/ 30-60 橙（暂停部分操作）/ <30 红（暂停账号）

---

## 七、当前进度（2026-05-01 状态快照 — 第 2 轮长会话末）

新会话开机请先读 [HANDOFF.md](HANDOFF.md)（同目录），那里有上一轮工作的全景 + 未完成项 + 已知 bug。本节是历史进度，HANDOFF 更新更勤。

### 已完成
- [x] 市场调研：GramJS / Telethon / TDLib / Pyrogram / Telegram Expert / 2026 反封号机制
- [x] 架构蓝图 v1.0 (`telehubx_architecture_blueprint.md`，716 行)
- [x] 完整计划书 v2.0 (`telehubx_full_plan.md`，744 行) — 整合所有设计决策
- [x] 推送 GitHub: https://github.com/bryangeh79/TeleHubX (commit b167368)
- [x] 设计决策对话归档：`Chat History/chat-Captain-1777470588788.md`
- [x] **Phase 1 基建（P1-1 ~ P1-14 全部完成）**
  - Monorepo: `apps/server` / `apps/agent` / `apps/dashboard`
  - NestJS 后端：ConfigModule、TypeORM、HealthController，端口 9800
  - Docker Compose：`telehubx-pg`(5436) + `telehubx-redis`(6386)
  - GramJS + StringSession + SOCKS5 代理 + 登录向导 (`pnpm login`)
  - 消息监听 / 发送 (text/image/video) / KeepOnline 心跳
  - BehaviorSimulator (Gaussian 随机延迟)
  - Account CRUD + 状态机 + BindWizard 前端 + Account List 前端
  - Agent DB 驱动：启动自动加载所有 `sessionEncrypted=true` 账号，30s 轮询
  - Slot Pool (稳定编号，release→reset gate)
  - pm2 ecosystem.config.cjs：server / dashboard / agent 三进程
- [x] **Wave 1–3 业务模块**
  - Wave 1: mock 骨架（Campaigns / ChatScripts / Leads / Proxies / Slots / AI-Agent / Knowledge）
  - Wave 2: Knowledge Base (7 类) + FAQ 关键字匹配 + AutoReplyDecider + Takeover (人工接管)
  - Wave 3: 多租户 (Tenants) + 授权 (Licenses) + Auth (scrypt + HMAC-SHA256 JWT)
- [x] 端口迁移：Backend 9600→9800 / PG 5433→5436 / Redis 6380→6386（让给 FAhubX）
- [x] 桌面快捷方式：`Start-TeleHubX.bat` / `Stop-TeleHubX.bat` / VBS 无闪烁启动器 / `Create-Shortcuts.ps1`
- [x] ChatScripts stub 模块（entity / dto / controller / service）

### 进行中 / 下一步（新 session 从这里接手）

#### 已完成（2026-04-30 当天）
- [x] **C1：Bot API 客服入口** — `tenant_bots` 表 + BotGateway 长轮询（25s）+ AutoReplyDecider 分支
- [x] **双层 AI Key 体系** — 租户自有 key（客户聊天）vs 平台兜底（FAQ 生成等内部任务）
- [x] **三档回复模式** — off/faq/smart 真切换 + 确认弹窗 + AI key 验证
- [x] **知识库重做（P2）** — KbSource + KbProtected + AI 生成 FAQ + 文件上传（txt/md/PDF/docx）
- [x] **WAhubX 风格 UI 重构** — 顶部水平菜单 + 整体中文化 + Settings/Scheduler/Admin 页面骨架

#### 待做（Wave 1 优先）
- [ ] **任务调度后端** — 建 `tasks` entity + scheduler service，对齐前端 SchedulerPage 字段（in progress）
- [ ] **C2：Takeover WebSocket 桥** — 实时人工 → Agent → TG 消息派发
- [ ] **Lead 实际 TG 派发** — 目前只写 DB，需接通 GramJS sendMessage

#### 待做（用户已决策但延后实施 — 2026-04-30 记）
- [ ] **License 激活流程** — 客户首次登录在 `/activate` 页输入 license key 激活系统；后端 POST `/licenses/activate` 已建好骨架，前端需要打通
- [ ] **VPS license 心跳** — VPS 后台定时（建议 30 分钟）调用 license 中心校验有效期；过期自动暂停服务并弹窗提示
- [ ] **SaaS Admin 后端实装** — `/admin` 页面前端骨架已建（4 tab：租户管理/License 签发/全局 AI/系统监控），后端需要补：
  - 租户 CRUD + 暂停/恢复 + 配额调整
  - License 签发 API（生成 + 签名 + 关联 tenant）
  - 全局默认 AI Key 管理（从 `.env` 迁移到可视化配置 + 使用量统计）
  - 全局任务队列状态聚合
  - **同一登录页**：根据用户 role（SUPER_ADMIN）自动放行 `/admin` 路由

#### 工程化 / 生产前必做
- [ ] **TypeORM migrations** — 取代 `synchronize: true`（生产前必做）
- [ ] **JWT 路由守卫落地** — Wave 3 auth 建好了但守卫未 enforce
- [ ] **多租户行级隔离** — schema-per-tenant 未实现，目前单 schema
- [ ] **agent 端 AI 调用走 effectiveAiConfig** — 当前 BotGateway 已切，但 cs MTProto 账号走 agent 那条路还没切

#### SaaS 多租户架构关键决策（2026-05-01 记，用户已知道但延后）
- [ ] **每租户独立 api_id / api_hash** — 当前所有租户共享 `.env` 中一个 `TG_API_ID`，TG 后台数据上 N 租户看起来是同一个 app。租户多了（>5）会被 TG 风控当成"自动化应用"。
  - 短期 (<5 租户): 共享 .env api_id 凑合
  - 中期 (5-50 租户): TenantSettings 加 `tgApiId` / `tgApiHash` 字段，每租户在 https://my.telegram.org 自己注册一个 app，填进 dashboard
  - 长期 (50+ 租户): 平台维护 api_id 池，自动轮询分配；被封时迁移
  - 改动点：bind.service / agent main.ts 创建 TelegramClient 时改为 `tenant.tgApiId ?? envFallback`

### Phase 顺序（v2.0 已确认）
```
Phase 1: Telegram 底层基建（GramJS + Session + Docker + 代理 + 行为模拟）
Phase 2: 搬 WAhubX AI 客服 + FAQ + KB（改接入层）
Phase 3: Campaign 4 层架构 + 归因
Phase 4: Takeover + Lead Collection（修 WAhubX 缺陷）
Phase 5: ChatScript 剧本引擎 + 多账号 Warmup + 角色分离
Phase 6: SaaS 化（schema-per-tenant + 套餐 + billing-ready）
```

### Phase 1 详细任务（14 项，~36h）
| 编号 | 任务 | 工时 |
|------|------|------|
| P1-1 | Monorepo 结构 (apps/server, apps/agent, apps/dashboard) | 2h |
| P1-2 | NestJS 基础 (app.module, main, config, db) | 3h |
| P1-3 | Docker Compose (PostgreSQL + Redis) | 1h |
| P1-4 | GramJS 连通测试 + StringSession | 3h |
| P1-5 | SOCKS5 代理集成 | 2h |
| P1-6 | Incoming message 监听 | 2h |
| P1-7 | SendMessage text/image/video | 3h |
| P1-8 | KeepOnline 心跳 | 2h |
| P1-9 | BehaviorSimulator (Gaussian) | 3h |
| P1-10 | Account CRUD + 状态机 | 3h |
| P1-11 | BOT API 客服接入骨架 | 3h |
| P1-12 | 前端骨架（路由+空白页面） | 3h |
| P1-13 | Bind Wizard 前端组件 | 4h |
| P1-14 | Account List 前端 | 3h |

---

## 八、WAhubX 复用对照（重要）

### 完全复用（直接搬业务逻辑）
`signing` / `ai` / `intelligent-reply` / `takeover` / `assets` / `auth` / `account-health` / `execution-groups` / `channel-items` / `licenses`

### 部分复用 60-70%
- `campaigns` — 改发送通道 (WA Web → TG MTProto)
- `backup` — 改 session 格式
- `tenants` — 适配 TG 模型

### 必须重写
- `messaging` — WA DOM → TG MTProto API 调用
- `slots` — Chromium session → GramJS StringSession
- `runtime-chromium` → GramJS Client
- `runtime-process` — Node GramJS 进程
- `warmup` — WA 浏览/发帖 → TG 加群/频道/互动
- `human-behavior` — TG 消息延迟/行为

---

## 九、注意事项与红线

### 绝对禁止
- **不要修改 `C:\AI_WORKSPACE\Whatsapp Auto Bot` 任何文件** — WAhubX 是只读参考
- 不要硬编码租户名/产品名/Bot 名（用 `{tenantName}` / `{botName}` 占位）
- 不要让广告号主动私聊陌生人（默认关闭，需 Super Admin 显式启用）
- 不要在所有号开 AI 回复（API 费用爆炸 + 引人警觉）— 单一 Bot 客服入口
- 不要用 Datacenter Proxy / Telegram Web 自动化 / 共享 IP

### 设计要点
- Takeover = 必须立即停 AI 并阻断广告任务（WAhubX 老缺陷，TeleHubX 一开始就做对）
- 所有间隔走 Gaussian，不用固定计时器
- AI 行为/Provider/规则全部 tenant 级配置，不写代码里
- 客户端 (Runtime Agent) 跑容器，服务端只做编排 + Web Dashboard
- Phase 优先级：**先底层基建，后业务搬运**（与 GPT 建议反着来，已论证）

### 工程约定
- 提交信息用中文或英文都可，按 WAhubX 风格
- 不要在文件里写 emoji（除非用户明确要求）
- 不要主动创建 *.md 文档（README/CHANGELOG 例外）
- 编辑 `telehubx_*.md` 文件后要 push GitHub

---

## 十、关键文档索引

| 文件 | 用途 |
|------|------|
| `telehubx_architecture_blueprint.md` | v1.0 架构蓝图（716 行）— 顶层架构、技术选型、容器、模块复用 |
| `telehubx_full_plan.md` | v2.0 完整计划书（744 行）— 20 章覆盖所有设计决策 |
| `Chat History/chat-Captain-1777470588788.md` | 2026-04-29 设计对话原始归档（6238 行） |
| `AGENTS.md` / `IDENTITY.md` / `SOUL.md` / `USER.md` 等 | OpenClaw 框架文件 |

---

## 十一、给新 Session 的开场建议

如果你是新启动的 Claude Code session，请先做这件事：

1. **读本文件（CLAUDE.md）第七节"当前进度"** — 这是最新状态，比 telehubx_full_plan.md 更新
2. **不要重做已完成的事** — Phase 1 + Wave 1-3 全部完成，不要重建任何已存在的模块
3. 参考文档优先级：`CLAUDE.md`（本文） > `HANDOFF.md` > `telehubx_full_plan.md` > `telehubx_architecture_blueprint.md`
4. WAhubX 路径在 `C:\AI_WORKSPACE\Whatsapp Auto Bot`，**只读不写**
5. 默认行为：**直接从"进行中/下一步"列表的第一项开始**，无需询问

### 端口速查
| 服务 | 端口 |
|------|------|
| Backend (NestJS) | 9800 |
| Dashboard (Vite) | 9601 |
| PostgreSQL (Docker) | 5436 |
| Redis (Docker) | 6386 |

### 常用命令
```bash
# 启动
cd "C:\AI_WORKSPACE\Telegram Auto Bot"
Start-TeleHubX.bat          # 双击或 cmd 执行

# pm2
pm2 status
pm2 logs telehubx-server
pm2 restart telehubx-server

# 编译后端
cd apps/server && pnpm build

# 账号登录
cd apps/agent && pnpm login
```
