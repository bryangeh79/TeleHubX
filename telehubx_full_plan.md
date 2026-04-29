# TeleHubX — 完整项目计划书

> **项目名称:** TeleHubX
> **GitHub:** https://github.com/bryangeh79/TeleHubX
> **本地路径:** `C:\AI_WORKSPACE\Telegram Auto Bot`
> **版本:** v2.0 (已整合所有设计决策)
> **状态:** 待启动
> **基于:** WAhubX 架构经验 + 2025-2026 Telegram 养号行业调研 + GPT 设计评审

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [核心架构决策](#3-核心架构决策)
4. [账户角色体系](#4-账户角色体系)
5. [智能回复设计](#5-智能回复设计)
6. [广告投放模块](#6-广告投放模块)
7. [ChatScript 剧本引擎](#7-chatscript-剧本引擎)
8. [Lead Collection 线索收集](#8-lead-collection-线索收集)
9. [Takeover 人工接管](#9-takeover-人工接管)
10. [FAQ / 知识库](#10-faq--知识库)
11. [AI 设置产品化](#11-ai-设置产品化)
12. [SaaS 多租户与 License](#12-saas-多租户与-license)
13. [部署架构](#13-部署架构)
14. [数据库设计](#14-数据库设计)
15. [API 设计](#15-api-设计)
16. [前端设计](#16-前端设计)
17. [反检测与防封策略](#17-反检测与防封策略)
18. [阶段计划](#18-阶段计划)
19. [风险评估](#19-风险评估)
20. [WAhubX 复用对照表](#20-wahubx-复用对照表)

---

## 1. 项目概述

### 1.1 项目目标

TeleHubX 不是 Telegram 群发器。
TeleHubX 是 **"Telegram 广告投放 + 多账号养号 + AI 智能客服 + 人工接管 + 线索收集"** 的 SaaS 系统。

核心商业逻辑：**广告号负责引流，客服号负责成交。**

### 1.2 核心能力矩阵（更新版）

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 多账号管理（客服号 + 广告号） | 角色分离，独立 Session，独立代理 | P0 |
| 账号绑定/登录 | Phone + OTP，Session 持久化 | P0 |
| 自动保持在线 | 心跳 + 随机小动作 | P0 |
| 消息收发 | 文本/图片/视频/文件 | P0 |
| AI 智能回复（Bot API 客服入口） | FAQ-only / AI Smart Reply | P0 |
| FAQ / 知识库（7 类） | 产品资料/FAQ/价格/售后/素材/风控/公司介绍 | P0 |
| 广告投放（Campaign 4 层架构） | 计划 → 素材 → 执行 → 归因 | P1 |
| AI 变体广告文案 | 同一文案自动生成 N 种变体，防重复检测 | P1 |
| ChatScript 多角色剧本引擎 | A+B+C+D 多账号群组对话/引导 | P1 |
| Warmup 渐进式养号 | P0-P4 阶段，7+ 天周期 | P1 |
| 人工接管（Takeover） | AI 立即停止，客户进入人工池 | P1 |
| Lead Collection 线索收集 | 结构化提取/归因/意向评级 | P1 |
| 群组管理 | 加群/退群/发言（自建+加入别人群） | P1 |
| 好友管理 | 加好友/接受邀请 | P2 |
| 频道管理 | 关注/转发/互动 | P2 |
| 健康监控 | 账号评分/风险预警/自动降级 | P0 |
| 多语言 | i18n 架构预留 | P3 |

### 1.3 项目名称与版本命名

- **项目名:** TeleHubX（telegram + hub + X）
- **版本策略:** `v<主>.<副>.<补丁>`，从 v1.0 开始

---

## 2. 技术架构（蓝图参考）

关键技术选型：

| 层面 | 选型 | 说明 |
|------|------|------|
| **客服模块** | Bot API (Telegram Bot) | 低风险，无限名额，适合客服 Bot / 群内自动回复 / Webhook |
| **广告/账号模块** | MTProto Client (GramJS) | 多账号 + 群组 + 私聊 + Session |
| **不推荐** | Telegram Web 自动化 | 稳定性差，不适合 SaaS 长期运行 |

> **TeleHubX 决策：** 客服优先用 Bot API，广告号/养号用 GramJS MTProto，不用 Telegram Web 自动化做核心底层。

---

## 3. 核心架构决策

### 3.1 多账号在线广告任务分配

**复用 WAhubX Execution Groups + Channel Items 模式。**

```
总目标 300 封广告
  → 筛选可用账号（Warmup P4+ 成熟账号）
  → 300 / 30 = 10 封/号
  → 分配到 Execution Groups（按时间窗打散）
  → 每个 Group 内的 Channel Items 控制每个账号的发送内容
  → AI Variant 生成不同文案（同一意思 N 种写法）
  → Gaussian 间隔发送（10min-30min 随机）
  → 执行
```

**AI Variant 变体策略：**

| 维度 | 变体策略 |
|------|---------|
| 文字 | AI 改写：句式、语气、长度变化 |
| 表情 | 有无/位置/类型随机 |
| 标点 | 句号 vs 感叹号 vs 省略号 |
| 首尾格式 | 问候语、署名随机 |
| 图片 | 同一图片微偏移/crop |
| 时间 | 同一目标账号不重复触达 |

### 3.2 群来源管理：自建 + 加入别人群

| 方式 | 用途 | 操作 |
|------|------|------|
| **自建群 2-3 个** | 剧本引擎执行、养号、客户沉淀 | 系统创建 → 账号陆续加入 → 剧本执行 → 引导客户进群 |
| **加入别人群** | 快速触达潜在客户 | 公开群链接/搜索加入 → 剧本/广告 → 引流到 Bot |

**加入别人群风控：** 低 → 大群偶尔参与话题；中 → 中小群温和文案 + AI 变体；高 → 禁止入群即发链接。成熟账号 (P4+) 每天加 1-2 个新群，先观察 24h 再发言。

### 3.3 Telegram 底层方案

| 方案 | 适用 | 不适用 |
|------|------|--------|
| **Bot API** | 客服 Bot、群自动回复、Webhook | 模拟普通用户私聊营销 |
| **MTProto (GramJS)** | 多账号、群组、私聊、Session 持久化 | 需要严格限速和风控 |
| **Telegram Web 自动化** | 快速原型 | SaaS 长期运行 |

---

## 4. 账户角色体系

### 4.1 角色定义

| 角色 | 值 | 功能 |
|------|-----|------|
| **客服号 (cs)** | `role: 'cs'` | AI 自动回复 + FAQ + 知识库 + 接管 |
| **广告号 (ad)** | `role: 'ad'` | 关闭 AI 自动回复，仅执行 Campaign / 剧本 / 养号 |
| **混合号 (hybrid)** | `role: 'hybrid'` | 可配置：AI 回复 + 广告都做（高风险，需 Super Admin 覆盖） |

### 4.2 角色行为规则

```
cs 号：
  - 私聊 → AI 智能回复
  - 群组 → AI 智能回复
  - 不执行广告任务
  - 被动等待客户联系

ad 号：
  - 群组消息 → FAQ 固定回答（简短 1-2 句，不带 AI）
  - 私聊消息 → 统一回复 "请点击联系客服 @TeleHubXBot"
  - 执行 Campaign 广告任务
  - 执行 ChatScript 剧本
  - 执行 Warmup 养号动作
  - 不展开 AI 对话

hybrid 号：
  - 广告 + AI 回复都启用
  - 更严格的消息来源判断
```

---

## 5. 智能回复设计

### 5.1 单一客服入口架构

```
广告号 A（MTProto） → 发广告到群
    ↓ 客户看到，私聊 Bot
Bot（Bot API）      → AI 客服接待
    ↓ 收集需求/意向
    ↓ 转人工（可选）
Dashboard Takeover  → 人工跟进
```

**为什么只设 1 个客服入口：** 50 个号都开 AI 回复 → API 费用 × 50；群组 AI 回复引人警觉；单一入口 = 流量归因追踪。

### 5.2 广告号 FAQ 回答规则

```
广告号收到群组消息：
  → 匹配 Knowledge Base group_faq 条目
  → 匹配则回复 1-2 句固定模板
  → 不匹配则忽略
  → 每天上限 10 条/账号

广告号收到私聊消息：
  → 统一回复引流文案
  → 不展开对话
```

### 5.3 AI 回复优先级

```
1. 明确命中 FAQ → 直接答
2. 明确命中产品/服务 → 查产品 KB
3. 客户问价格 → 有配置才答，没有转人工
4. 客户有购买意图 → 收集线索 + 转人工
5. 投诉/技术问题/账号异常 → 直接转人工
6. 闲聊 → 简短回应，拉回业务
7. 无资料 → 不乱编，追问或转人工
```

---

## 6. 广告投放模块

### 6.1 Campaign 四层架构

**Layer 1: Campaign 广告计划**
- 名称
- 目标群组/私聊名单/频道
- 投放账号池（仅 ad/hybrid 角色）
- 投放时间窗
- 每账号每日上限
- 素材组

**Layer 2: 广告素材**
- 文案（支持 AI 变体）
- 图片/视频/文件
- CTA：引导到客服 Bot / 群组 / 链接
- AI 改写版本（N 种变体）

**Layer 3: 投放执行**
- 分账号发送
- Gaussian 随机间隔
- 失败降速（指数退避）
- 被限自动暂停
- 不同账号不同素材
- 防重复触达（同一客户不重复收到）

**Layer 4: 投放归因**
- 哪个账号发出
- 哪个 campaign
- 哪个群/哪个用户
- 客户是否回复
- 是否进入 AI 客服
- 是否转人工
- 是否成为 hot lead

### 6.2 广告分配逻辑

```typescript
async function distributeCampaign(campaign: Campaign) {
  const accounts = await getAdAccounts(campaign.tenantId);  // 仅 ad/hybrid
  const matureAccounts = accounts.filter(a => a.warmupPhase >= 4);
  const totalTargets = campaign.targets.length;
  const perAccount = Math.floor(totalTargets / matureAccounts.length);
  
  for (const account of matureAccounts) {
    const targets = campaign.targets.splice(0, perAccount);
    const variants = await generateAIVariants(campaign.content, Math.min(targets.length, 10));
    await executionGroupService.create({
      accountId: account.id,
      campaignId: campaign.id,
      targets,
      variants,
      schedule: { start: campaign.startTime, interval: 'gaussian(10m, 5m)' },
      dailyLimit: campaign.dailyLimitPerAccount,
    });
  }
}
```

### 6.3 私聊风控分级

| 私聊场景 | 风险 | 允许 | 风控 |
|---------|------|------|------|
| 客户主动私聊广告号 | 低 | ✅ | 引流到 Bot |
| 客户 @ 广告号后私聊 | 中 | ✅ | 仅回复 @ 相关话题 |
| 广告号主动私聊陌生人 | 高 | ❌ 默认关闭 | 需 Super Admin 覆盖 |
| 批量私聊名单 | 极高 | ⚠️ 可配置 | P4+ 日限额 ≤ 20 + Gaussian 5-15min + 变体 ≥ 5 |

**默认：** 群发到群组 ✅ | 私聊发名单 ⚠️ 限速 | 主动私聊陌生人 ❌

---

## 7. ChatScript 剧本引擎

### 7.1 定义

多角色群组对话剧本，在群内模拟真实用户对话，引导潜在客户产生兴趣。

```
剧本 "产品咨询"：
  角色 A（广告号1）："有人用过TeleHubX吗？最近在找TG自动化工具"
  角色 B（广告号2）："我在用TeleHubX，还不错。你在找什么功能？"
  角色 C（广告号3）："楼上能私聊下吗？我也想了解"
  角色 A："我也想知道，方便分享一下吗？"
  → 客户看到对话
  → 所有号引导客户私聊客服 Bot
```

### 7.2 实体设计

```typescript
interface ChatScript {
  id: string;
  tenantId: string;
  name: string;
  groupIds: string[];
  accounts: string[];  // 必须是 ad/hybrid
  lines: ScriptLine[];
  schedule: { cron: string; maxDaily: number; activeHours: [number, number] };
  status: 'active' | 'paused';
}

interface ScriptLine {
  accountIndex: number;
  text: string;
  delayAfter: number;      // 均值(ms)
  delayStdDev: number;     // 标准差
  variantCount?: number;
}
```

### 7.3 执行规则

- 群内有活跃（真人聊天）时跳过，不入侵
- 群冷场时才执行剧本
- 每句间隔 Gaussian 抖动
- 每句 AI 生成变体
- 一天同一群只执行一次

---

## 8. Lead Collection 线索收集

### 8.1 字段

```typescript
interface Lead {
  id: string;
  tenantId: string;
  tgUsername: string;
  tgUserId: string;
  displayName: string;
  campaignId?: string;
  campaignName?: string;
  accountId?: string;
  groupId?: string;
  product: string;
  accountSize: string;
  budgetRange: string;
  language: string;
  intentLevel: 'cold' | 'warm' | 'hot';
  needsHuman: boolean;
  firstContactAt: Date;
  lastReplyAt: Date;
  messagesCount: number;
  notes: string;
  assignedTo?: string;
}
```

### 8.2 AI 销售 SOP

```
客户：你好
AI：想了解哪一类服务？可以帮您介绍功能、价格或开通流程。

客户：怎样用？
AI：请问您主要想做群组推广、私聊触达，还是 AI 客服？

客户：我要推广
AI：请问您有多少 Telegram 账号要管理？10 个、30 个还是 50 个以上？

客户：30 个
AI：这适合 Pro 方案。我帮您记录需求，转给顾问确认配置和价格 😊
```

支持 CSV 导出。

---

## 9. Takeover 人工接管

**修补 WAhubX 缺陷，TeleHubX 一开始就确保：**

```
人工接管某个 conversation 后：
  1. AI 立即停止回复该客户
  2. 广告任务不能再碰该客户
  3. 该客户进入人工跟进池
  4. 人工释放后，AI 才能恢复
  5. 所有接管/释放操作写 audit
```

**接管页面：** 客户资料面板（来源 campaign、AI 判断意图、AI 推荐回复）、操作区（接管/释放/Hot Lead/Closed/DNR/备注）、聊天窗口（含 AI 完整对话历史）。

---

## 10. FAQ / 知识库

### 10.1 7 类知识库

| 类型 | 用途 | 来源 |
|------|------|------|
| 产品资料 KB | 功能/服务介绍 | 上传产品文档 |
| 价格/套餐 KB | 定价策略 | 上传价格表 |
| 售前 FAQ | 常见咨询问题 | 手动/AI 生成 |
| 售后 FAQ | 使用/维护问题 | 手动录入 |
| 公司介绍 KB | 品牌/背景 | 上传 PPT/PDF |
| 广告素材 KB | 广告文案参考 | 手动录入 |
| 风控/禁答规则 KB | 不回答内容 | 手动配置 |

### 10.2 复用 WAhubX

- FAQ CRUD、批量导入、AI 生成 FAQ、Starter FAQ、AI 优化
- PDF/Word/txt/md 上传、Chunking、RAG 检索（pgvector）

### 10.3 TeleHubX 新增

- KB 类型扩展为 7 类
- 广告素材 KB 特殊管理界面
- 风控/禁答规则 KB（命中直接转人工）
- Starter FAQ 占位符使用 `{tenantName}` / `{botName}`，不硬编码

---

## 11. AI 设置产品化

### 11.1 AI 开关

| 模式 | 行为 |
|------|------|
| 关闭 | 不回复任何消息 |
| FAQ-only | 仅从知识库 FAQ 匹配 |
| AI Smart Reply | FAQ + LLM 生成 |

### 11.2 AI Provider（复用 WAhubX）

OpenAI / DeepSeek / Gemini / Claude / Custom OpenAI-Compat

### 11.3 AI 行为配置

| 配置项 | 选项 |
|--------|------|
| 回复语言 | zh / en / ms / auto |
| 回复长度 | short / medium / long |
| 语气 | 专业 / 亲切 / 销售型 / 简短 |
| 允许 emoji | on / off |
| 主动追问 | on / off |
| 主动收集线索 | on / off |

### 11.4 安全规则

- 不报价格（除非 KB 有）
- 不承诺 100%
- 不回答无关问题
- 不讨论竞品
- 命中敏感词 → 转人工
- 技术问题 / 投诉 → 转人工

### 11.5 客服规则

- 工作时间可配置
- 夜间模式：关闭 / FAQ-only / AI
- 每客户每日 AI 回复上限
- 转人工关键词可配
- 黑名单关键词可配

所有配置按 tenant 隔离。

---

## 12. SaaS 多租户与 License

与 v1.0 一致（schema-per-tenant + Ed25519 License），此处略。

---

## 13. 部署架构

与 v1.0 一致（轻量 VPS 服务端 + 重量客户端容器农场），此处略。

---

## 14. 数据库设计（新增实体）

```sql
-- 账户角色
ALTER TABLE accounts ADD COLUMN role VARCHAR(20) DEFAULT 'ad';  -- cs / ad / hybrid

-- Campaign 4 层
CREATE TABLE campaign_plans (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL, name VARCHAR(128),
    status VARCHAR(20) DEFAULT 'draft', start_time TIMESTAMPTZ, end_time TIMESTAMPTZ,
    daily_limit_per_account INTEGER, account_pool JSONB, targets JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE campaign_materials (
    id UUID PRIMARY KEY, plan_id UUID REFERENCES campaign_plans(id),
    type VARCHAR(20), content TEXT, media_url VARCHAR(512),
    cta_type VARCHAR(32), cta_value VARCHAR(512),
    ai_variants JSONB, lang VARCHAR(10) DEFAULT 'zh',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE campaign_executions (
    id UUID PRIMARY KEY, plan_id UUID REFERENCES campaign_plans(id),
    account_id UUID REFERENCES accounts(id), target_id VARCHAR(128),
    material_id UUID REFERENCES campaign_materials(id), variant_index INTEGER,
    status VARCHAR(20) DEFAULT 'pending', scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
    error_message TEXT, created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE campaign_attributions (
    id UUID PRIMARY KEY, execution_id UUID REFERENCES campaign_executions(id),
    customer_tg_id VARCHAR(64), customer_tg_username VARCHAR(128),
    replied BOOLEAN DEFAULT FALSE, entered_ai BOOLEAN DEFAULT FALSE,
    transferred_human BOOLEAN DEFAULT FALSE, became_lead BOOLEAN DEFAULT FALSE,
    lead_id UUID REFERENCES leads(id), created_at TIMESTAMP DEFAULT NOW()
);

-- ChatScript
CREATE TABLE chat_scripts (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL, name VARCHAR(128),
    account_ids JSONB, group_ids JSONB, lines JSONB, schedule JSONB,
    status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE chat_script_executions (
    id UUID PRIMARY KEY, script_id UUID REFERENCES chat_scripts(id),
    group_id VARCHAR(128), status VARCHAR(20) DEFAULT 'pending',
    current_line INTEGER DEFAULT 0, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);

-- Leads
CREATE TABLE leads (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL,
    tg_username VARCHAR(128), tg_user_id VARCHAR(64) NOT NULL, display_name VARCHAR(128),
    campaign_id UUID REFERENCES campaign_plans(id), campaign_name VARCHAR(128),
    account_id UUID REFERENCES accounts(id), group_id VARCHAR(128),
    product VARCHAR(255), account_size VARCHAR(64), budget_range VARCHAR(64),
    language VARCHAR(10), intent_level VARCHAR(20) DEFAULT 'cold',
    needs_human BOOLEAN DEFAULT FALSE,
    first_contact_at TIMESTAMPTZ, last_reply_at TIMESTAMPTZ, messages_count INTEGER DEFAULT 0,
    notes TEXT, assigned_to VARCHAR(128), status VARCHAR(20) DEFAULT 'new',
    created_at TIMESTAMP DEFAULT NOW()
);

-- AI 行为配置（按 tenant）
CREATE TABLE ai_behavior_config (
    id UUID PRIMARY KEY, tenant_id UUID NOT NULL,
    language VARCHAR(10) DEFAULT 'zh', reply_length VARCHAR(10) DEFAULT 'medium',
    tone VARCHAR(20) DEFAULT 'friendly', allow_emoji BOOLEAN DEFAULT TRUE,
    proactive_question BOOLEAN DEFAULT TRUE, collect_leads BOOLEAN DEFAULT TRUE,
    work_hours_start VARCHAR(5) DEFAULT '09:00', work_hours_end VARCHAR(5) DEFAULT '21:00',
    night_mode VARCHAR(20) DEFAULT 'faq', daily_reply_limit INTEGER DEFAULT 50,
    handoff_keywords JSONB, blacklist_keywords JSONB, guardrails JSONB,
    created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 15. API 设计（新增端点）

```
PUT    /api/v1/accounts/:id/role             设置角色 (cs/ad/hybrid)

POST   /api/v1/campaigns                    创建 Campaign
GET    /api/v1/campaigns/:id/attributions    归因数据
POST   /api/v1/campaigns/:id/materials      添加素材

POST   /api/v1/chat-scripts                 创建剧本
POST   /api/v1/chat-scripts/:id/execute     手动执行

GET    /api/v1/leads                        线索列表
POST   /api/v1/leads/export                 导出 CSV

GET    /api/v1/ai/behavior                  获取 AI 行为配置
PUT    /api/v1/ai/behavior                  更新 AI 行为配置
```

---

## 16. 前端设计

### 16.1 菜单与页面路由

| 菜单 | 功能 | 参考 WAhubX |
|------|------|-------------|
| Dashboard | 今日发送/回复/AI接待/转人工/Hot Leads | ✅ DashboardPage |
| Accounts | 账号列表/角色/绑定向导 | ✅ SlotsPage + BindWizard |
| Warmup | 阶段设置/行为计划/每日窗口 | ✅ admin/WarmupTab |
| Campaigns | 计划列表/创建向导5步/归因报告 | ✅ AdsHomePage |
| AI Reply | AI 开关/Provider/行为配置/安全规则 | ✅ ReplyPage + admin/AiTab |
| Knowledge Base | 7 类 KB/FAQ CRUD/RAG/Starter | ✅ admin/ChannelsTab |
| Inbox / Takeover | 客户会话/AI记录/接管/Hot Lead | ✅ TakeoverPage |
| Leads | 线索列表/归因/意向/导出 | 🆕 新增 |
| ChatScripts | 剧本管理/台词编辑/执行历史 | 🆕 新增 |
| Settings | 系统/用户/备份/i18n | ✅ SettingsPage |
| Admin | AI/Assets/Proxy/Health 等 12 tab | ✅ AdminPage |

```typescript
<Routes>
  <Route path="/activate" element={<ActivatePage />} />
  <Route path="/login" element={<LoginPage />} />
  <Route path="/" element={<DashboardPage />} />
  <Route path="/accounts" element={<AccountsPage />} />
  <Route path="/accounts/:id/bind" element={<BindWizard />} />
  <Route path="/warmup" element={<WarmupPage />} />
  <Route path="/campaigns" element={<CampaignListPage />} />
  <Route path="/campaigns/new" element={<CampaignWizard />} />
  <Route path="/reply" element={<ReplyPage />} />
  <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
  <Route path="/takeover" element={<TakeoverPage />} />
  <Route path="/leads" element={<LeadsPage />} />
  <Route path="/chat-scripts" element={<ChatScriptsPage />} />
  <Route path="/settings" element={<SettingsPage />} />
  <Route path="/admin" element={<AdminPage />} />
</Routes>
```

### 16.2 UI 设计决策

- **AI 配置页** → 复用 WAhubX AiTab（Provider 表/Test/Enable），新增行为配置面板
- **Campaign 创建** → 复用 WAhubX 5 步 Wizard（StepTarget → StepContent → StepExecution → StepConfirm → Summary）
- **接管界面** → 复用 WAhubX TakeoverPage（ChatWindow + SessionList）
- **Leads 页** → 新增 Ant Design ProTable，筛选/搜索/导出
- **ChatScripts 页** → 新增，台词富文本编辑器
- **Admin 页** → 参考 WAhubX 12 tab 设计

---

## 17. 反检测与防封策略

（18 条规则同 v1.0 + 以下补充）

```
19. 广告号和客服号 IP 段不能重叠
20. 广告号变体文案相似度 < 70%
21. ChatScript 一天一群只执行一次
22. 加别人群 ≤ 2/天/账号
23. 自建群不用广告号日常参与，只跑剧本
```

---

## 18. 阶段计划（调整后）

```
Phase 1: Telegram 底层基建
  GramJS + Session + Docker + 代理 + 行为模拟

Phase 2: 搬 WAhubX AI 客服 + FAQ + 知识库（改接入层）

Phase 3: Campaign 4 层架构（WAhubX 广告改造 + 归因）

Phase 4: Takeover + Lead Collection（修补 WAhubX 缺陷）

Phase 5: ChatScript 剧本引擎 + 多账号 Warmup + 角色分离

Phase 6: SaaS 化（schema-per-tenant + 套餐 + billing-ready）
```

### Phase 1 详细任务

| 编号 | 任务 | 工时 |
|------|------|------|
| P1-1 | Monorepo 结构 (apps/server/agent/dashboard) | 2h |
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

## 19. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Telegram 更新协议 GramJS 失效 | 中 | 高 | 关注社区；备选 TDLib |
| 住宅代理成本高 | 中 | 中 | 套餐转嫁；支持用户自备代理 |
| 账号批量被封 | 中 | 高 | 行为模拟 + IP 隔离 + 单账号不牵连 |
| VPS IP 被封 | 低 | 低 | 服务端不直接连 TG |
| License Key 破解 | 低 | 高 | Ed25519 + 在线验证 |
| WAhubX 版本冲突 | 中 | 低 | 独立 monorepo 抽共享库 |

---

## 20. WAhubX 复用对照表

### 完全复用

| WAhubX 模块 | 用途 |
|-------------|------|
| modules/signing | License Ed25519 |
| modules/ai | AI Provider |
| modules/intelligent-reply | FAQ + AI 回复 |
| modules/takeover | WS Gateway + 接管状态机 |
| modules/assets | 素材池 |
| modules/auth | JWT + RBAC |
| modules/account-health | 健康评分 |
| modules/execution-groups | 任务分组 |
| modules/channel-items | 群/频道素材 |
| modules/licenses | License 实体 |
| frontend: takeover/ | 接管界面 |
| frontend: assets/ | 素材管理 |
| frontend: campaigns/ | 广告 UI |
| frontend: admin/AiTab | AI Provider 管理 |

### 部分复用

| WAhubX 模块 | 复用率 | 改动点 |
|-------------|--------|--------|
| modules/campaigns | 70% | 改发送通道 (WA→TG) |
| modules/backup | 60% | 改 session 格式 |
| modules/tenants | 60% | 适配 TG 模型 |

### 重写

| WAhubX 模块 | 新方案 |
|-------------|--------|
| modules/messaging | TG MTProto API |
| modules/slots | GramJS session |
| modules/runtime-chromium | GramJS Client |
| modules/runtime-process | Node GramJS 进程 |
| modules/warmup | TG 加群/频道/互动 |
| modules/human-behavior | TG 消息延迟/行为 |

---

*本文档覆盖 TeleHubX 全部设计决策。版本 v2.0 — 发布日期: 2026-04-29*
