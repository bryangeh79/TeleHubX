# TeleHubX — 会话交接 (2026-05-03)

> 给下一个 Claude Code 会话：读完这一份 + CLAUDE.md 第七节，即可无缝接手。
> 上一轮会话主要做了**广告投放完善 + 智能客服全套人设/公司/产品体系**，从 commit `31df47e` 到 `1ab3cf4`，push 30+ commit。

---

## 0. 立刻执行（开机后第一件事）

```bash
cd "C:\AI_WORKSPACE\Telegram Auto Bot"
git log --oneline -15        # 看最新 commit
pm2 status                   # 确认 server / agent / dashboard 都 online
docker ps                    # telehubx-pg + telehubx-redis 是否在跑
```

期待：3 个 pm2 进程 online，2 个 docker 容器健康。如有问题先 `Start-TeleHubX.bat`。

---

## 1. 当前最新状态 (HEAD)

```
HEAD = 1ab3cf4 (feat: company-wizard 编辑时智能反填 + 局部合并保存)
分支 main，已推 GitHub
```

**完成模块速查**：
- ✅ 22 类任务全部 executor 落地（含 chat_script_6p）
- ✅ 广告投放完整流程：调度预览 + 失败重试 + 错误信息可读 + 复制功能
- ✅ 聊天剧本 2/4/6 人 + 自建剧本编辑器 + 跑剧本时静默自动回复
- ✅ AI 客服人设全局化（18 章人设，DB 存储，Admin 可编辑）
- ✅ 智能客服向导：公司资讯 + 多产品（PDF 上传 → AI 生成 30-50 FAQ）
- ✅ 知识库 UI 简化（隐藏保留实体 tab）+ WAhubX 风格大卡片显示
- ✅ 高级设置可编辑（每日上限、夜间静默时段）

---

## 2. 上一轮做的核心改动（按时间倒序）

### A. 公司资讯 + 产品向导（智能客服核心）
| 改动 | Commit |
|---|---|
| 编辑时智能反填（goalPrompt 反推 email/website/about）+ 保存局部合并 | `1ab3cf4` |
| 自动回复模式三卡对齐 + 高级设置改可编辑 | `329bd31` |
| 知识库 Tab 改 WAhubX 风格大卡片 + 修 undefined 公司名 | `9436a81` |
| 产品向导 formMirror 防跨步骤丢值 | `d2d9024` |
| 产品向导改 5 步引导式 + 8 业务目标 + 客户类型 + 公司 FAQ 兜底 | `0bbd639` |
| 知识库 Tab 显示已配置内容支持一键编辑 | `13a28b9` |
| KB DTO 加 tenantId + description/goalPrompt 限制提到 20000 | `0156e25` |

### B. AI 配置体系修复
| 改动 | Commit |
|---|---|
| Knowledge 用 Repository 直接查 DB 消除循环依赖 | `9bc3992` |
| AiFaqGeneratorService 优先读 DB 平台 Provider（修 OpenAI 失效但 DeepSeek 配了仍报错）| `4b196d0` |
| AI 客服人设 18 章存入 platform_settings + Bot Gateway 接入 | `cfa8ccc` |

### C. 公司资讯向导专项
| 改动 | Commit |
|---|---|
| 网址提取与 AI 生成分开 try-catch 避免误报 | `f95e8a3` |
| 从官网提取后自动 AI 生成简介填入表单 | `ffcbb69` |
| 重做公司资讯向导：上传介绍书 + 网页提取 + 营业时间下拉 + 多平台联系方式 | `4033592` |
| 公司资讯+产品设置按钮移到正确的 CsPage（不是 AiSettingsPage） | `e15bd54` |
| AI 一键生成 30-50 FAQ + 智能客服页面顶部两个引导式按钮 | `c3b369e` |

### D. 广告号话术 + 聊天剧本
| 改动 | Commit |
|---|---|
| 广告号话术可视化配置（素材库第 3 Tab，agent 30s 动态同步） | `80d0ccf` |
| 6 人剧本支持 + 自建剧本编辑器 | `d5b8de4` |
| 跑剧本时账号自动回复全部静默 | `fa66bc3` |

### E. 广告投放完善
| 改动 | Commit |
|---|---|
| 单条/批量重试失败任务 + 错误信息清晰显示 + 「再次执行」改名「复制」 | `027b5fd` |
| 任务超时机制 + watchdog 清理卡住任务（只清叶子任务，不误杀父任务） | `801f214` |
| 调度时间不合理修复（立即模式小批量直发 + 跳过过期时段 + interval 边界保护） | `0e5b4a9` |
| 调度计划预览 — Wizard Step4 + 日志面板「调度分布」Tab | `887b12d` |
| 任务失败时也触发 campaign 完成检测 | `29f4821` |

---

## 3. 智能客服系统现状（重点）

### Bot 回复链路
```
客户 → @TeleHubX01_bot (Bot API)
  ↓
Server pollLoop (30s) → 标准化 + 创建 Lead
  ↓
AutoReplyDecider 根据 replyMode：
  ├─ off  → 不回
  ├─ faq  → 仅 FAQ 命中才回
  └─ smart → FAQ 优先 + AI 兜底（推荐）
  ↓
buildSmartReplyPrompt：
  [全局 AI 人设 (18 章，从 DB platform_settings 读)]
  +
  [knowledge.searchForContext (匹配 KB 命中的 FAQ)]
  ↓
AI Provider 调用（优先用租户 key，没配则用平台兜底）
  ↓
botReply.sendText
```

### 已有数据
- AI Key：DeepSeek 已配置（管理面板 → 平台 AI Providers）
- 全局人设：18 章营销客服人设已存入 platform_settings
- 公司资料：StarBright Solutions（**之前 description 缺字段，编辑保存即修复**）
- 产品资料：M33 Lotto Bot (50 FAQ) + FAhubX (51 FAQ)
- Bot 已配置：@TeleHubX01_bot 轮询中

### 知识库结构
```
公司通用 (KB type=company, ★ 默认)
  ├── description JSON: { companyName, industry, about, email, website, contacts, hours }
  └── goalPrompt: AI 生成的公司档案（自然语言）

产品 KB (KB type=product, 每个产品一个)
  ├── description JSON: { productName, price, category, customerType, goalKey, useCompanyFallback, overview, features }
  ├── goalPrompt: 业务目标 prompt 注入文本
  └── faqs (多条 Faq 表关联)
```

---

## 4. 已知未实现 / 已知 bug（新会话注意）

### 4.1 DB 历史脏数据
- **公司资料 name = "undefined - 公司资料"**：旧 bug 留下的，让用户点编辑→填名字→保存即可修复（CompanyInfoWizard 已加智能反填，会从 goalPrompt 自动反推 email/website/about）

### 4.2 客户类型 + 公司 FAQ 兜底（前端已有，后端未接入）
- 产品向导 Step 2 有 `customerType` (b2b/b2c/mixed) 和 `useCompanyFallback` 开关
- 但 Bot Gateway 的 `buildSmartReplyPrompt` 还没读这两个字段做差异化（Phase B 未做，按用户需求再加）

### 4.3 Webhook 网页提取的 SPA 限制
- 用户填官网点「从网站提取」→ 后端 `POST /knowledge/extract-url` 用 `node:https` 模块直接 fetch
- 仅支持 SSR 网页，SPA（React/Vue 前端渲染）拿到的是空壳

### 4.4 行业类别只是记录，未驱动业务逻辑
- 新建公司时选了行业，但目前只是存入 description.industry，**没有用来调整 prompt** — Phase 2 可以加行业特定话术注入

### 4.5 通用 FAQ 还没单独入口
- 用户说想要「通用 FAQ」（客户闲聊话题），现在是公司资料的 goalPrompt 兼任
- 后续可以加专门的「通用 FAQ」管理（设计：FAQ.kbId 指向 company KB 即可）

---

## 5. 用户的核心设计决策（避免再问）

1. **租户视角第一**：所有功能要"租户都不懂技术"也能用。复杂的 prompt / API 配置等技术细节藏起来
2. **Wizard 引导优先**：复杂功能用多步引导式 Modal，不要让用户面对一堆字段慌张
3. **AI 一键生成**：上传介绍书 → AI 30-50 条 FAQ + 业务目标。租户只需要确认/调整
4. **8 个业务目标模板**：综合 / 收集联系方式 / 引导预约 / 促成下单 / 引导加社群 / 询价 / 发资料 / 筛意向客户
5. **保留实体功能保留但隐藏**：phone/email/url 自动后台抽取保护，但不在 UI 里暴露给租户
6. **Bot 人设固定 + 全局**：18 章营销客服人设是平台级默认，所有租户共享，Admin 可编辑
7. **公司通用资料 vs 产品资料分层**：公司 KB 是兜底，产品 KB 优先

---

## 6. 数据库现状（重要）

### 表
- `tasks`: 父子结构 (parentTaskId), seq 自增
- `lead_candidates`: 候选池
- `campaigns`: 广告投放
- `knowledge_bases`: KB 主表 (type: product/pricing/presales_faq/support_faq/company/ad_material/guardrail)
- `faqs`: KB 关联的 Q&A
- `kb_sources`: 上传的文档
- `kb_protected`: 保留实体（自动抽取，UI 隐藏）
- `platform_ai_configs`: 平台级 AI Provider Key（DB 优先于 .env）
- `platform_settings`: KV 通用配置（全局人设 / 广告话术 / 变体 prompt）
- `tenant_settings`: 租户级配置（replyMode/dailyReplyLimit/quietHours/tenantAi*）
- `tenant_bots`: Telegram Bot Token + 状态

### 运行环境
- DB: `localhost:5436` (telehubx / telehubx)
- Redis: `localhost:6386`
- Server: `http://localhost:9800/api/v1`
- Dashboard: `http://localhost:9601` (Vite dev)

---

## 7. 关键代码位置速查

| 功能 | 文件 |
|---|---|
| 公司资讯向导 | `apps/dashboard/src/pages/ai/CompanyInfoWizard.tsx` |
| 产品设置向导（5 步） | `apps/dashboard/src/pages/ai/ProductSetupWizard.tsx` |
| 智能客服主页面（按钮 + 知识库 Tab） | `apps/dashboard/src/pages/cs/CsPage.tsx` |
| 知识库管理（已简化） | `apps/dashboard/src/pages/knowledge/KnowledgePage.tsx` |
| Bot 智能回复人设 | `apps/server/src/bot-gateway/bot-gateway.service.ts` (buildSmartReplyPrompt) |
| AI FAQ 生成 + 产品档案生成 | `apps/server/src/knowledge/ai-faq-generator.service.ts` + `knowledge.service.ts` (generateProductProfile) |
| 网址提取 | `apps/server/src/knowledge/knowledge.controller.ts` (extract-url) |
| 全局人设默认 | `apps/server/src/platform-config/platform-config.service.ts` (DEFAULT_GLOBAL_PERSONA) |
| Admin 面板 Prompt 配置 | `apps/dashboard/src/pages/admin/AdminPage.tsx` (GlobalPersonaTab + VariantPromptTab) |
| 广告号话术（agent 动态同步） | `apps/agent/src/main.ts` (syncAdFaqConfig) |
| 聊天剧本编辑器 | `apps/dashboard/src/pages/chat-scripts/ChatScriptEditor.tsx` |
| 广告投放向导（Step 4 调度预览） | `apps/dashboard/src/pages/campaigns/CampaignWizard.tsx` (DispatchPreviewCard) |
| 广告投放日志（重试 + 调度分布） | `apps/dashboard/src/pages/campaigns/CampaignLogDrawer.tsx` |

---

## 8. 用户偏好 / 沟通风格（必看）

- **直接干别问**：auto mode 一直开。说"执行"/"开干"/"继续"立刻动手
- **PDF 是真理**：`TeleHubX 自动化任务说明书.pdf` 是用户认可的设计规格
- **说人话不说技术**：错误信息 / 任务详情 / 表单 extra 都要中文 + 业务语言
- **不要罗嗦**：答完 + 下一步建议 + 短
- **每次 commit + push**：即时同步 GitHub
- **不许偷懒**：复杂任务认真做，不能简化敷衍
- **截图调试节奏**：用户截图 → 立刻查 DB + agent 日志 → 发 commit 修复
- **plan mode**：用户说"plan mode"或显式进入 plan mode 时，先 explore + 写计划文件 + ExitPlanMode 等批准
- **WAhubX 不能写**：`C:\AI_WORKSPACE\Whatsapp Auto Bot` 是只读参考

---

## 9. 立刻可以做的下一步（按价值排序）

### A. 后端接入新字段（Phase B）
- `KnowledgeBase` 加 `customerType` 和 `useCompanyFallback` 字段
- `bot-gateway.service.ts` 的 `buildSmartReplyPrompt` 根据这两个字段调整：
  - To B → prompt 注入"语气专业正式"
  - To C → prompt 注入"语气亲切轻松"
  - useCompanyFallback=true → 同时注入公司 KB 上下文
- 工时：1-2h

### B. 行业类别驱动（Phase 2）
- 行业 enum 映射到行业特定 prompt 注入
- 例：金融业自动加风险提示 / 教育业偏推体验课 / 餐饮业偏菜单订位
- 工时：1h（编写 prompt 映射表）

### C. 通用 FAQ 单独管理入口
- 现在客户闲聊只能依赖人设第九章 + 公司 goalPrompt
- 加一个专门的「通用 FAQ」编辑器，让租户写常见闲聊回应（例如"你们 Bot 是真人吗"）
- 工时：1h

### D. License 激活流程前端打通
- 后端 `/licenses/activate` 接口已建好，前端 `/activate` 页面骨架在
- 工时：2h

---

## 10. 端口表

| 服务 | 端口 |
|---|---|
| Backend NestJS | 9800 |
| Dashboard Vite | 9601 |
| PostgreSQL Docker | 5436 |
| Redis Docker | 6386 |

---

## 11. 常用命令

```bash
# 启动
Start-TeleHubX.bat

# pm2
pm2 status
pm2 logs telehubx-server --lines 30
pm2 logs telehubx-agent --lines 30 --nostream
pm2 restart telehubx-server
pm2 restart telehubx-agent --update-env
pm2 restart telehubx-dashboard

# 编译
cd apps/server && pnpm build
cd apps/agent && pnpm build
cd apps/dashboard && pnpm build

# DB
docker exec telehubx-pg psql -U telehubx -d telehubx -c "<SQL>"

# 看公司资料 / 产品 / FAQ 数量
docker exec telehubx-pg psql -U telehubx -d telehubx -c "SELECT type, COUNT(*) FROM knowledge_bases GROUP BY type;"
docker exec telehubx-pg psql -U telehubx -d telehubx -c "SELECT \"kbId\", COUNT(*) as faqs FROM faqs GROUP BY \"kbId\";"
```

---

## 12. 关键设计决策（用户问过别再问）

1. **公司资料一次设置可随时改** — KB type='company' 默认 ★ 标记
2. **每个产品独立 KB + FAQ + 业务目标** — 多产品互不干扰
3. **客户问产品**：Bot 自动匹配 KB → 命中产品 FAQ
4. **客户问公司/闲聊**：fallback 到公司通用 KB
5. **客户问完全无关**：18 章人设第九章规则——简短回应 + 引导回主题
6. **8 个业务目标模板**：每个对应不同 system prompt 注入逻辑（见 ProductSetupWizard.buildGoalPrompt）
7. **AI Key 双轨制**：DB 平台兜底（管理面板配） + 租户自有（智能客服页配）
8. **保留实体自动化**：上传文档时后台自动抽 phone/email/url，UI 不显示

---

## 13. 文件位置速查

```
关键代码
  apps/server/src/tasks/tasks.service.ts        — 编排器/dispatch/recalc 父任务
  apps/server/src/tasks/task.entity.ts          — 22 TaskType enum
  apps/server/src/leads-candidates/             — 候选人池
  apps/agent/src/tasks/executors.ts             — 22 executor 实现
  apps/agent/src/tasks/script-mute.ts           — 聊天剧本静默管理
  apps/agent/src/main.ts                        — Agent 启动 + adFaqConfig 同步
  apps/server/src/bot-gateway/                  — Bot API 长轮询 + 智能回复
  apps/server/src/knowledge/                    — KB / FAQ / AI 生成
  apps/server/src/platform-config/              — 平台级配置（AI Key + KV settings）
  apps/dashboard/src/pages/cs/CsPage.tsx        — 智能客服主页（按钮 + 知识库 Tab + 高级设置）
  apps/dashboard/src/pages/ai/                  — AI 配置 + 公司向导 + 产品向导
  apps/dashboard/src/pages/campaigns/           — 广告投放
  apps/dashboard/src/pages/scheduler/           — 任务调度
  apps/dashboard/src/pages/chat-scripts/        — 聊天剧本管理 + 编辑器
  apps/dashboard/src/pages/admin/AdminPage.tsx  — 管理面板（Prompt 配置 + 全局 AI）

关键文档
  CLAUDE.md                                     — 项目背景
  HANDOFF.md                                    — 本文档（新会话第一站）
  TeleHubX 自动化任务说明书.pdf                 — 22 task 设计规格
```

---

**就这些。新会话开机后：**
1. `git log --oneline -10` 看上下文
2. `pm2 status` 确认服务起来了
3. 用户开口说话再决定干啥
4. 没说话 → 等用户指令，不要自己跑

---
2026-05-03 完成 30+ commits，主要 push 在 31df47e → 1ab3cf4 区间。
重点工作：智能客服全栈（人设/公司/产品向导）+ 广告投放完善 + 聊天剧本扩展。
