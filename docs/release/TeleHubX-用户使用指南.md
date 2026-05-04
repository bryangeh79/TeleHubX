---
pdf_options:
  format: A4
  margin: 22mm 18mm
  printBackground: true
  headerTemplate: |
    <div style="font-size:9px; color:#888; width:100%; padding:0 18mm;">
      <span style="float:right;">TeleHubX 用户使用指南 · v1.0</span>
    </div>
  footerTemplate: |
    <div style="font-size:9px; color:#888; width:100%; text-align:center;">
      第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页 · TeleHubX · 2026
    </div>
stylesheet_encoding: utf-8
body_class: markdown-body
css: |
  body { font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif; line-height: 1.75; color: #1f1f1f; font-size: 10.5pt; }
  h1 { font-size: 24pt; color: #1677ff; border-bottom: 3px solid #1677ff; padding-bottom: 8px; margin-top: 0; page-break-before: always; }
  h1:first-of-type { page-break-before: auto; }
  h2 { font-size: 16pt; color: #1f1f1f; border-left: 4px solid #1677ff; padding-left: 10px; margin-top: 26px; }
  h3 { font-size: 13pt; color: #333; margin-top: 20px; background: #fafafa; padding: 6px 10px; border-radius: 4px; }
  h4 { font-size: 11.5pt; color: #555; margin-top: 16px; }
  p, li { font-size: 10.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; }
  th { background: #f5faff; color: #1677ff; padding: 7px 9px; border: 1px solid #d9e7f7; text-align: left; }
  td { padding: 6px 9px; border: 1px solid #e8e8e8; vertical-align: top; }
  blockquote { border-left: 3px solid #1677ff; background: #f5faff; padding: 8px 14px; margin: 10px 0; color: #444; font-size: 10pt; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: "Consolas", monospace; font-size: 9.5pt; color: #c41d7f; }
  pre { background: #2d2d2d; color: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 9.5pt; }
  pre code { background: transparent; color: inherit; padding: 0; }
  hr { border: none; border-top: 1px solid #d9d9d9; margin: 20px 0; }
  .cover { text-align: center; padding: 60mm 0 30mm; page-break-after: always; }
  .cover h1 { font-size: 36pt; border: none; color: #1677ff; margin-bottom: 6mm; }
  .cover .subtitle { font-size: 16pt; color: #555; margin-bottom: 30mm; }
  .cover .meta { font-size: 11pt; color: #888; margin-top: 60mm; }
  .step-tag { display: inline-block; background: #1677ff; color: white; padding: 2px 8px; border-radius: 10px; font-size: 9pt; font-weight: bold; margin-right: 6px; }
  .tip { background: #f6ffed; border-left: 3px solid #52c41a; padding: 10px 14px; margin: 12px 0; }
  .warning { background: #fffbe6; border-left: 3px solid #faad14; padding: 10px 14px; margin: 12px 0; }
  .danger { background: #fff1f0; border-left: 3px solid #cf1322; padding: 10px 14px; margin: 12px 0; }
  .toc { background: #fafafa; border: 1px solid #f0f0f0; border-radius: 6px; padding: 20px 30px; margin: 20px 0; }
  .toc ul { list-style: none; padding-left: 12px; }
  .toc > ul { padding-left: 0; }
  .toc li { margin: 4px 0; font-size: 10.5pt; }
---

<div class="cover">

# TeleHubX

<div class="subtitle">用户使用指南</div>

<div style="font-size:14pt; color:#666; max-width:130mm; margin:0 auto; line-height:1.9;">
从首次登录到日常运营 · 完整操作手册<br/>
14 章 · 适合所有运营 / 客服 / 管理员使用
</div>

<div class="meta">
v1.0 · 2026<br/>
© TeleHubX · 保留所有权利
</div>

</div>

# 目录

<div class="toc">

1. **快速开始** — 首次登录与 5 分钟激活
2. **添加 Telegram 账号** — 手把手绑定第一个号
3. **代理配置** — 一号一 IP 的安全前提
4. **Bot 智能客服设置** — 客户消息入口配置
5. **AI Key 接入** — 三种模式选哪种
6. **知识库与 FAQ** — 让 AI 答得对
7. **创建广告投放** — 4 步完成 Campaign
8. **7 天科学养号** — Warmup 任务派发
9. **群源发现与候选人池** — 精益拉新
10. **人工接管对话** — 客服转手实操
11. **任务调度与状态监控**
12. **系统维护（自助诊断）** — 出问题自己修
13. **管理员操作** — 用户 / License / 平台 AI
14. **常见问题与故障排查**

</div>

---

# 第 1 章 · 快速开始

## 1.1 系统要求

打开浏览器访问平台地址，推荐使用：

| 浏览器 | 最低版本 | 备注 |
|---|---|---|
| Chrome | 110+ | **强烈推荐** |
| Edge | 110+ | 兼容 |
| Firefox | 115+ | 兼容 |
| Safari | 16+ | 部分功能受限 |

> 屏幕分辨率最低 1366×768，推荐 1920×1080 或更高。

## 1.2 首次登录

<span class="step-tag">步骤 1</span> 打开浏览器访问 `https://你的平台地址`（销售会提供）

<span class="step-tag">步骤 2</span> 输入销售给你的 **用户名 / 密码**

<span class="step-tag">步骤 3</span> 首次登录系统会要求 **激活 License**：
- 在「激活页面」输入销售提供的 **License Key**（格式如 `XXXXX-XXXXX-XXXXX-XXXXX`）
- 点「激活」→ 自动绑定到你的租户

<span class="step-tag">步骤 4</span> 进入仪表盘，看到 4 张 KPI 卡片说明系统正常

<div class="tip">
<b>💡 提示</b>: 首次登录后，<b>立即在「头像 → 修改密码」处更换默认密码</b>。
</div>

## 1.3 仪表盘介绍

登录后看到的首页就是 **仪表盘**，4 张 KPI 卡：

| 卡片 | 显示内容 | 实时刷新 |
|---|---|---|
| 🤖 账号 | 总账号数、健康分布、在线状态 | 30s |
| 🎯 候选人池 | 累计候选人、未触达数、今日新增 | 30s |
| 💬 客户对话 | 进行中、待人工、今日新增 | 实时 |
| 🔥 广告投放 | 投放中 / 完成、当周转化数 | 30s |

## 1.4 顶部导航介绍

| 菜单 | 用途 |
|---|---|
| **仪表盘** | 总览 |
| **账号** | TG 账号管理（绑定 / 健康 / 隔离） |
| **任务调度** | 所有自动化任务的列表 + 详情 |
| **广告投放** | Campaign 管理 |
| **智能客服** | Bot + AI 配置 + 知识库 |
| **人工接管** | Lead 对话池 |
| **候选人池** | 爬到的潜在客户 |
| **群源发现** | 关键词搜群 + 质量评分 |
| **设置** | 代理 / 知识库 / 养号 / 素材 / 群组 / **系统维护** |
| **管理面板** | （仅 SUPER_ADMIN）租户 / License / 用户 / 全局 AI |

---

# 第 2 章 · 添加 Telegram 账号

## 2.1 准备工作

绑定一个 TG 账号需要准备：

1. ✅ **一个能收 SMS 的手机号**（最好是马来西亚 / 新加坡 / 香港等账号长期可用地）
2. ✅ **一个固定的代理 IP**（详见第 3 章）— **强烈推荐住宅 / 4G SIM 代理**
3. ✅ **手机号已经在 Telegram App 注册过**（推荐：先用真机注册，再迁移到平台）

<div class="danger">
<b>⚠️ 红线</b>: 千万<b>不要</b>用 Datacenter 代理（AWS / Linode / DigitalOcean 公开 IP），TG 几乎秒封。
</div>

## 2.2 绑定流程

<span class="step-tag">步骤 1</span> 顶部菜单「账号」→ 右上角 **「添加账号」** 按钮

<span class="step-tag">步骤 2</span> 选择「**绑定向导**」

<span class="step-tag">步骤 3</span> **填写信息**：

| 字段 | 说明 | 示例 |
|---|---|---|
| 手机号 | 国际格式带 + | `+60123456789` |
| 角色 | 客服号(cs) / 广告号(ad) | 选 **ad** 用于投放 |
| 代理 | 下拉选择已添加的代理 | （第 3 章先添加） |

<span class="step-tag">步骤 4</span> 点「**发送验证码**」→ 系统通过该代理向 TG 发起请求 → 你的手机收到 SMS

<span class="step-tag">步骤 5</span> **输入 5 位 SMS 验证码** → 点「验证」

<span class="step-tag">步骤 6</span> 如果该号开启了**两步验证密码 (2FA)**，会要求输入。如果你忘了，需要在 TG App 里重置 2FA 密码后再来绑定。

<span class="step-tag">步骤 7</span> 看到「**绑定成功**」绿色提示，账号会出现在账号列表，状态为 **online**

## 2.3 账号绑定后必须做的检查

绑定后立即检查：

1. **状态**: 应该是 🟢 `online`
2. **Health Score**: 默认 100
3. **代理**: 显示已绑定的代理 host:port

如果状态是 🔴 `error`，先看「失败原因」字段，常见原因：
- 验证码错误 → 重新触发
- 2FA 密码错误 → 检查
- 代理失效 → 换个代理重试

## 2.4 账号角色选择指南

| 角色 | 主要用途 | AI 回复 | 主动发送 |
|---|---|---|---|
| **cs (客服号)** | 接待客户咨询 | ✅ 开启 | ❌ 不发 |
| **ad (广告号)** | Campaign / 群发 / 养号 | ❌ 关闭 | ✅ 主动 |
| **hybrid (混合号)** | ⚠️ 高风险 | 视配置 | 视配置 | 

<div class="warning">
<b>⚠️ 建议</b>: 1 个客服号 + N 个广告号是最安全配比。客服号永不主动发，广告号永不开 AI。
</div>

## 2.5 批量导入账号

如果你已经有一批 TG session 文件，可以批量导入：

<span class="step-tag">步骤 1</span> 「账号」→「**批量导入**」

<span class="step-tag">步骤 2</span> 准备 CSV 文件：

```csv
phoneNumber,role,proxyHost,proxyPort,proxyUsername,proxyPassword
+60123456789,ad,1.2.3.4,1080,user1,pass1
+60123456790,ad,1.2.3.5,1080,user2,pass2
```

<span class="step-tag">步骤 3</span> 上传 CSV → 系统自动逐条创建账号 + 分配 slot

<span class="step-tag">步骤 4</span> 完成后，每个账号还需要单独 **重新登录**（绑定 session）

---

# 第 3 章 · 代理配置

## 3.1 为什么需要代理

Telegram 会根据账号登录的 **IP 段**判断风险：

- 同一 IP 多账号登录 → 高风险
- IP 频繁变化 → 高风险（"用户在飞机上吗？"）
- Datacenter IP → 极高风险

**铁律**: **一号一固定 IP，永不轮换**

## 3.2 推荐的代理类型

| 类型 | 月费/IP | TG 友好度 | 推荐度 |
|---|---|---|---|
| **静态 4G/LTE SIM** | $4-8 | ⭐⭐⭐⭐⭐ | 最佳 |
| **静态住宅 (ISP)** | $2-5 | ⭐⭐⭐⭐ | 推荐 |
| **轮换住宅** | $5-10/GB | ❌ IP 会变 | 禁用 |
| **Datacenter** | $1 | ❌ 几乎秒封 | 禁用 |

## 3.3 添加代理

<span class="step-tag">步骤 1</span> 「设置」→「**代理管理**」

<span class="step-tag">步骤 2</span> 「**添加代理**」

<span class="step-tag">步骤 3</span> 填写：

| 字段 | 说明 |
|---|---|
| 协议 | SOCKS5（推荐）/ HTTP |
| Host | 代理服务器 IP / 域名 |
| Port | 端口（SOCKS5 通常 1080） |
| Username | 认证用户名（无认证留空） |
| Password | 认证密码（无认证留空） |
| 备注 | 例: "马来西亚移动 #1" |

<span class="step-tag">步骤 4</span> 点「**测试连接**」→ 系统通过该代理拉取 ipinfo，返回观察到的外网 IP + 延迟

✅ 测试成功 → status = `active`，可绑定账号
❌ 测试失败 → 检查代理凭据 / 代理服务商联系支持

## 3.4 代理与账号的绑定关系

- **一对一**: 每个代理只绑给一个账号
- **永不轮换**: 绑定后不要轻易换代理
- **失效处理**: 代理死了 → 找服务商修复 / 换新代理 → 在账号详情页重新绑定

---

# 第 4 章 · Bot 智能客服设置

## 4.1 为什么用 Bot 而不是 MTProto 账号做客服

| 维度 | Bot API | MTProto 客服号 |
|---|---|---|
| 风控 | **极低**（官方公开接口） | 中等 |
| 频率限制 | **无** | 有 |
| 群发能力 | 弱 | 强 |
| 适用 | **客服接待** | 主动触达 / 拉新 |

> TeleHubX 的智能客服**默认走 Bot API 入口**，最安全。

## 4.2 在 Telegram 注册 Bot

<span class="step-tag">步骤 1</span> 在 Telegram App 搜索 `@BotFather` → 点「Start」

<span class="step-tag">步骤 2</span> 发送 `/newbot` 命令

<span class="step-tag">步骤 3</span> 按提示：
- 输入 Bot 显示名（例: `XX 智能客服`）
- 输入 Bot username（必须以 `bot` 结尾，例: `xx_support_bot`）

<span class="step-tag">步骤 4</span> BotFather 返回 **HTTP API Token**（形如 `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`）→ **务必保存**

<span class="step-tag">步骤 5</span> （可选）发送 `/setdescription`、`/setuserpic` 完善 Bot 资料

## 4.3 在 TeleHubX 接入 Bot

<span class="step-tag">步骤 1</span> 顶部菜单「**智能客服**」

<span class="step-tag">步骤 2</span> 「**注册 Bot**」按钮

<span class="step-tag">步骤 3</span> 粘贴 Bot Token → 系统自动调 `getMe` 验证 → 成功后入库

<span class="step-tag">步骤 4</span> 看到 Bot 卡片：
- 🟢 绿色 = 长轮询正在运行，可接收客户消息
- 🔴 红色 = token 失效或被撤销

<div class="tip">
<b>💡 测试</b>: 用你自己的 Telegram 号搜你的 Bot username → 点 Start → 发条消息 → 检查是否收到回复（默认 FAQ 模式没配置时回 fallback 文案）。
</div>

## 4.4 Bot 三档回复模式

| 模式 | 行为 |
|---|---|
| **off** | 关闭，所有消息进人工接管 |
| **faq** | 只用 FAQ 关键字匹配，命中就回，未命中转人工 |
| **smart** | FAQ + AI 检索知识库 + AI 生成回复 |

切换模式：「智能客服」→「**回复模式**」选项卡 → 选档 → 保存

> **smart 模式** 必须先配 AI Key（第 5 章）+ 知识库（第 6 章），否则 AI 没东西可参考。

---

# 第 5 章 · AI Key 接入

## 5.1 三种 AI 来源对比

| 选项 | 谁付费 | 数据流向 | 成本 |
|---|---|---|---|
| 用平台兜底 Key | 平台 | 与平台共享 | 0（包含在套餐内） |
| 自配 OpenAI / DeepSeek | 你 | 直连 Provider | 按 Token 计费 |
| 自配自定义 OpenAI 兼容 | 你 | 私有部署 | 自定义 |

> **推荐**: 中文场景选 **DeepSeek V3**（性价比之王，月费 $5 内搞定大部分租户）。

## 5.2 配置自有 AI Key

<span class="step-tag">步骤 1</span> 「设置」→「**AI 配置**」

<span class="step-tag">步骤 2</span> 「智能回复 AI Key」卡片 → 「**编辑**」

<span class="step-tag">步骤 3</span> 选 Provider + 填配置：

### 5.2.1 OpenAI

| 字段 | 值 |
|---|---|
| Provider | OpenAI |
| API Key | `sk-...` |
| Model | `gpt-4o-mini`（推荐） |
| Base URL | 留空（用默认） |

### 5.2.2 DeepSeek

| 字段 | 值 |
|---|---|
| Provider | DeepSeek |
| API Key | 在 https://platform.deepseek.com 注册获取 |
| Model | `deepseek-chat` |
| Base URL | 留空（用默认） |

### 5.2.3 Google Gemini

| 字段 | 值 |
|---|---|
| Provider | Gemini |
| API Key | 在 Google AI Studio 获取 |
| Model | `gemini-2.0-flash` |

### 5.2.4 自定义 OpenAI 兼容

适合用 vLLM / Ollama / Together / DeepInfra 等私有部署模型。

| 字段 | 值 |
|---|---|
| Provider | Custom |
| API Key | 你的 |
| Model | 模型名 |
| Base URL | `https://你的端点/v1`（**必填**） |

<span class="step-tag">步骤 4</span> 点「**保存并测试**」

✅ 显示「✓ AI 调用正常」+ 模型返回的样本 → 配置成功
❌ 显示错误 → 看错误提示（常见：key 失效、quota 超限、Base URL 写错）

## 5.3 AI 总开关

「设置 → AI 配置」顶部有 **AI 总开关**：

- ✅ **开启**: 系统会用 AI 为聊天 / 广告文案自动生成多样化变体（降低封号风险）
- ❌ **关闭**: 所有 AI 生成功能停用，仅留 FAQ 匹配

---

# 第 6 章 · 知识库与 FAQ

## 6.1 7 类知识介绍

| 类别 | 用途 | 示例文件 |
|---|---|---|
| 产品资料 | 产品介绍、规格 | product-spec.pdf |
| 价格套餐 | 定价、折扣 | pricing.md |
| 售前 FAQ | 高频咨询 | presales-faq.txt |
| 售后 FAQ | 使用问题 | aftersale-faq.txt |
| 公司介绍 | 资质、案例 | about.md |
| 广告素材 | 文案模板 | ad-templates.md |
| 风控禁答规则 | AI 不该答的话题 | dont-answer.md |

## 6.2 上传知识

<span class="step-tag">步骤 1</span> 「设置」→「**知识库**」

<span class="step-tag">步骤 2</span> 选择类别 → 「**上传文件**」

<span class="step-tag">步骤 3</span> 选择文件（支持 TXT / MD / PDF / DOCX，单文件 < 10MB）

<span class="step-tag">步骤 4</span> 系统自动：
- 解析文本内容
- 切片（chunk size ~500 字）
- 向量化（pgvector 存储）
- 加入 RAG 检索池

<span class="step-tag">步骤 5</span> 在「**已配置文档**」列表看到上传的文件 + 已生成的切片数

## 6.3 配置 FAQ

FAQ 是 AI 之外的"快速命中"机制，对**高频固定问题**最有效。

<span class="step-tag">步骤 1</span> 「智能客服」→「**FAQ 配置**」

<span class="step-tag">步骤 2</span> 「**添加 FAQ**」

<span class="step-tag">步骤 3</span> 填：

| 字段 | 说明 |
|---|---|
| 关键字 | 一行一个，如 `价格 / 多少钱 / 报价` |
| 回复内容 | 命中时返回的文案，可带 emoji 和 markdown |
| 是否启用 | ✅ |

<div class="tip">
<b>💡 写 FAQ 的最佳实践</b>:<br/>
1. <b>同一个问题写多个变体关键字</b>（例: "价格"、"多少钱"、"报价"、"几多钱"、"how much"）<br/>
2. <b>回复加上引导语</b>（例: 末尾"想了解详细套餐请联系 @sales_xx"）<br/>
3. <b>定期看人工接管池里"AI 没答上来"的问题，补到 FAQ</b>
</div>

## 6.4 测试 FAQ 是否命中

「智能客服 → 测试」面板，输入测试消息 → 看是否命中 FAQ + 返回什么。

---

# 第 7 章 · 创建广告投放 (Campaigns)

## 7.1 投放前检查清单

- ✅ 至少 5 个 ad 账号在 online 状态、Health > 70
- ✅ 每个 ad 账号都有自己的固定代理
- ✅ 已准备好目标群组列表（去「群组管理」录入）/ 候选人池
- ✅ 文案 + 素材（图片 / 视频）已准备
- ✅ 已开 AI 总开关（用 AI 生成变体降低封号）

## 7.2 创建 Campaign

<span class="step-tag">步骤 1</span> 「广告投放」→ 「**新建 Campaign**」

<span class="step-tag">步骤 2</span> **第 1 层 · 计划**

| 字段 | 说明 |
|---|---|
| 计划名 | 例: "12月外汇推广 Campaign" |
| 类型 | 群发 (group) / 私聊 (private) |
| 目标群组 | 选已添加的群组（多选） |
| 总配额 | 例: 300 条消息 |
| 起止时间 | 投放窗口 |

<span class="step-tag">步骤 3</span> **第 2 层 · 素材**
- 上传 / 选择已有素材（图 / 视频 / 文本）
- 写主文案
- 选 **AI Variant 数量**（推荐 5-10）→ 系统自动生成 N 种变体降低相似度

<span class="step-tag">步骤 4</span> **第 3 层 · 执行**

| 字段 | 说明 | 推荐值 |
|---|---|---|
| 参与账号 | 可选 ad 账号（系统按 health 自动负载均衡） | 全选 |
| 间隔策略 | Gaussian 或 固定 | **Gaussian** |
| 间隔均值 | 平均每条间隔（秒） | 60-120 |
| 间隔方差 | 随机波动幅度 | 30 |
| 失败重试 | 0/1/2/3 | **1** |

<span class="step-tag">步骤 5</span> **第 4 层 · 归因**
- 是否启用归因码（每条消息追加 `?ref=campaign_xx` 让你后续在客服对话能看到客户来自哪个 Campaign）

<span class="step-tag">步骤 6</span> 「**保存为草稿**」→ 检查无误 → 「**启动**」

## 7.3 投放过程监控

启动后 → 「广告投放 → Campaign 详情」可实时看：
- 总进度条 / 已发 / 失败 / 剩余
- 每个账号的执行情况
- 失败任务可单独重试 / 取消

## 7.4 控制配额

- 单账号每天 **不超过 50 条主动私聊**
- 单账号每天 **不超过 20 条群发**
- 触发 FloodWait → 系统自动隔离该账号 → 等隔离期结束自动恢复

---

# 第 8 章 · 7 天科学养号 (Warmup)

## 8.1 为什么必须养号

新 TG 账号绑定后**前 7 天最危险**。直接投放 = 几乎 100% 封号。

养号目的：让 TG 后台看到这个账号"像真人"再开始工作。

## 8.2 创建养号任务

<span class="step-tag">步骤 1</span> 「设置」→「**账号养号**」（或在账号详情页直接点「开始养号」）

<span class="step-tag">步骤 2</span> 选要养的账号

<span class="step-tag">步骤 3</span> 选模板：
- **7 天标准养号**（推荐新账号）
- **14 天运营热身**（衔接养号到投放）
- **30 天关键词智能引流**（拉新一条龙）

<span class="step-tag">步骤 4</span> 点「**派发**」→ 系统自动生成 N 个子任务，按 D1-D7 排好

## 8.3 养号过程中能做什么

**前 3 天什么都不要做**。让账号沉默 / 浏览 / 互动，自然成长。

D4 开始可以：
- 加入自建群（不发广告）
- 发 1-2 条短句到自建群

D7 完成后：
- Health Score > 70 → 可启动 Campaign
- Health Score < 70 → 延长养号 3 天

## 8.4 监控养号进度

「任务调度」→ 筛选 type = `warmup_*` → 看每个子任务执行情况

如果某个子任务失败 → 进「**系统维护 → 失败任务诊断**」看根因（详见第 12 章）

---

# 第 9 章 · 群源发现与候选人池

## 9.1 工作流概览

```
关键词搜群 → 自动质量评分 → 你人工挑 → 派发加群+爬群 →
  爬到的成员入候选人池 → 按优先级触达
```

## 9.2 创建群源发现任务

<span class="step-tag">步骤 1</span> 「群源发现」→ 「**搜群**」

<span class="step-tag">步骤 2</span> 填：

| 字段 | 说明 |
|---|---|
| 关键词 | 一行一个，例: `forex / crypto / 量化交易` |
| 使用账号 | 一个 ad 账号即可（不消耗配额） |
| 每词最多收录 | 50（默认） |

<span class="step-tag">步骤 3</span> 派发任务 → 等待 30 秒 → 「群源发现」列表会出现搜到的群

## 9.3 解读质量评分

每个搜到的群有 **0-100 分**：

| 维度 | 分值 |
|---|---|
| 基础 | +30 |
| 1k-50k 成员（甜点区间）| +30 |
| Basic group（非 channel）| +10 |
| 有真人发言 | +30 |
| 真发言者 ≥ 10 | +20 |
| Gigagroup（不能爬成员）| -30 |
| Channel | -50 |

**推荐挑选规则**: 评分 > 60 + 真发言者 > 10 + 不是 gigagroup

## 9.4 派发加群+爬群

<span class="step-tag">步骤 1</span> 在群源列表勾选高质量群

<span class="step-tag">步骤 2</span> 点「**派发加群+爬群**」

<span class="step-tag">步骤 3</span> 选执行账号（最好是已养完号的 ad 账号）

<span class="step-tag">步骤 4</span> 系统自动派发：
- `JOIN_GROUPS` 立即执行（加入群）
- `GROUP_SCRAPE` 10 分钟后执行（让群同步到 dialogs 后再爬）

## 9.5 查看候选人池

「候选人池」→ 看到爬到的所有候选人

| 列 | 说明 |
|---|---|
| TG 用户 | username + first/last name |
| 来源群 | 从哪个群爬到的 |
| 最后在线 | 最近活跃时间（越近越优质）|
| 优先级 | 系统自动评分 |
| 状态 | pending / contacted / replied / converted |

## 9.6 触达候选人

<span class="step-tag">步骤 1</span> 勾选要触达的候选人

<span class="step-tag">步骤 2</span> 「**批量派发**」

<span class="step-tag">步骤 3</span> 选模式：
- **CONTACT_ADD**: 加联系人 + 发开场白
- **CAMPAIGN_SINGLE**: 直接私聊群发

<span class="step-tag">步骤 4</span> 选执行账号 + 文案 → 派发

## 9.7 打包成客户群

候选人池积累到一定量，可以"打包"成客户群（CRM 视角）：

<span class="step-tag">步骤 1</span> 勾选候选人

<span class="step-tag">步骤 2</span> 「**打包成客户群**」

<span class="step-tag">步骤 3</span> 命名群 + 描述 → 创建

<div class="tip">
<b>💡 打包过的候选人有标记</b>，避免你重复打包同一批人。可勾「只看未打包」过滤。
</div>

---

# 第 10 章 · 人工接管对话

## 10.1 什么时候会出现人工接管

3 种情况：

1. AI 判断"无法回答"自动转人工
2. 客户主动说"找人工 / 转人工 / 真人客服"
3. FAQ 命中"转人工"关键词（例: 投诉、退款）

## 10.2 接管界面

「人工接管」页面分两栏：

- **左侧**: Lead 列表（按状态: 待处理 / 进行中 / 已关闭）
- **右侧**: 选中 Lead 后看完整对话历史 + 输入框

## 10.3 接管一个对话

<span class="step-tag">步骤 1</span> 左侧选「**待处理**」中的某个 Lead

<span class="step-tag">步骤 2</span> 看右侧对话历史，了解客户问题

<span class="step-tag">步骤 3</span> 点顶部「**接管**」按钮

<span class="step-tag">步骤 4</span> 系统自动：
- 该客户 AI 回复立即停止
- 该客户的广告任务自动跳过
- 状态从 `pending` 变 `human`

<span class="step-tag">步骤 5</span> 在右侧输入框打字 → 回车 → 通过该客户分配的客服 Bot 真送回 TG

<span class="step-tag">步骤 6</span> 沟通结束 → 点「**释放**」→ 该客户回归 AI 自动回复

## 10.4 客户标签与意向

每个 Lead 可以标记：

| 字段 | 选项 |
|---|---|
| 意向度 | 🥶 cold / 🌤 warm / 🔥 hot |
| 来源 | 自动归因（哪个 Campaign） |
| 行业 | 自定义标签 |
| 备注 | 自由文本 |

意向度 = `hot` 的客户在仪表盘有专门的"今日热客户"统计。

## 10.5 多操作员协作

如果有多个人工客服，每个 Lead 同时只能被一个操作员接管：

- 当某操作员接管后，其他操作员看到 Lead 状态 `human` + "已被 XX 接管"
- 释放后任何操作员都可重新接管

---

# 第 11 章 · 任务调度与状态监控

## 11.1 任务体系

TeleHubX 一切自动化都是「任务」。常见任务类型：

| 类型 | 用途 |
|---|---|
| `idle_keepalive` | 在线保活 |
| `browse_channel` | 浏览频道（养号） |
| `reaction_boost` | 给消息点赞（养号） |
| `join_groups` | 加群 |
| `group_scrape` | 爬群成员 |
| `discover_groups_by_keyword` | 关键词搜群 |
| `contact_add` | 添加联系人 + 开场白 |
| `campaign_single` | Campaign 投放 |
| `chat_script_*` | 多账号对话剧本 |

## 11.2 任务列表

「任务调度」→ 看到所有任务，可按以下维度过滤：

- 状态: pending / running / done / failed / paused
- 类型: 上面所列
- 账号: 哪个账号执行
- 时间: 创建 / 计划 / 执行时间

## 11.3 任务详情 Modal

点任意任务行 → 弹出详情：

- **基本信息**: ID / 类型 / 状态 / 进度
- **执行账号**: 哪个号在跑
- **子任务进度**: 父任务下所有子任务的进度（养号 7 天 = 15 个子任务）
- **错误信息**: 失败时的 errorMsg
- **操作**: 重试 / 取消 / 暂停

## 11.4 失败任务处理

如果某任务失败：

1. **看 errorMsg** 确认根因
2. **网络抖动 / RPC 超时** → 直接「重试」
3. **配置错** → 看任务 payload，去对应资源（账号 / 代理）修
4. **批量同类失败** → 用「**系统维护 → 失败任务诊断**」一键重试同类（详见第 12 章）

---

# 第 12 章 · 系统维护（自助诊断）

## 12.1 维护页入口

「**设置 → 系统维护**」

或直接访问 `/settings/maintenance`

## 12.2 五大自检模块

每个模块独立卡片，按需点「检查」（不会一进页面打 5 个网络请求）。

### M1 · 账号健康一键体检

点「一键体检」→ 1 秒后看到：
- 总账号数 / 健康 / 注意 / 危急 4 档统计
- 平均健康分（< 60 红色警告）
- 异常账号清单（health < 60 / banned / 长时间未上线 / 未登录）+ 修复建议
- 「**去处理**」直达账号详情页（重新登录 / 换代理）

### M2 · Bot 长轮询自检

点「全部检查」→ 对每个 Bot 调 TG getMe + 检查心跳：
- ✅ Token 有效 + 心跳 < 60s = 正常
- ⚠️ 心跳 60-120s = 注意
- ❌ 心跳 > 120s 或 Token 失败 = 异常 → 提示重启 server

### M3 · AI Key 测试

「测试租户 AI」→ 1 秒返回：
- ✅ 「✓ AI 调用正常」+ 模型返回样本
- ❌ 错误信息（key 失效 / quota 超 / 网络）

### M4 · 代理健康自检

「加载状态」→ 列出所有代理 + 失效清单 + 上次错误信息

> 单点重测请到「**设置 → 代理管理**」单独点

### M5 · 失败任务诊断 ⭐

**这是最有用的功能**。

近 1 / 7 / 30 天的失败任务按**根因分类**：

| 类别 | 颜色 | 可重试 |
|---|---|---|
| 网络/RPC 超时 | 橙 | ✅ |
| TG 限流 (FloodWait) | 红 | ❌ |
| 目标不存在 / 已删除 | 金 | ❌ |
| Agent 离线 / 卡死 | 红 | ✅ |
| Session 失效 / 未登录 | 红 | ❌ |
| 权限不足 / 被拒 | 紫 | ❌ |
| 零结果（非真错误）| 灰 | ❌ |
| 配置缺失/错误 | 紫 | ❌ |
| 未知错误 | 灰 | ✅ |

每个错误聚类卡片：
- 左侧大数字显示失败次数
- 中间错误样本 + **黄色 hint 框**给具体修复建议
- 右侧「**重试 N**」「**忽略**」操作

### 一键修复操作

| 操作 | 何时用 |
|---|---|
| **重试 N** | 网络超时 / Agent 离线 这种重试可恢复的 |
| **忽略** | 零结果 / 已删除目标 这种噪音任务 |

> retryable=false 的类别（FloodWait / Session 失效）「重试」按钮置灰，避免无效重试加重风控。

---

# 第 13 章 · 管理员操作（仅 SUPER_ADMIN）

普通运营看不到 / 用不到本章，本章面向**租户管理员或平台管理员**。

## 13.1 进入管理面板

顶部菜单「**管理面板**」（需 SUPER_ADMIN 角色）

## 13.2 租户管理

> 仅 SaaS 模式平台管理员有 / 独立部署默认 1 个租户

「租户管理」tab → 可以：
- 创建新租户（指定套餐 / 账号上限）
- 暂停 / 恢复租户
- 删除租户（不可逆）

## 13.3 License 签发

「License 签发」tab → 可以：
- 签发新 License（绑定租户 / 指定套餐 / 备注）
- 撤销 License
- 查看到期时间

新签 License 会得到一串 `XXXXX-XXXXX-XXXXX-XXXXX` 给客户，让客户在 `/activate` 页激活。

## 13.4 全局 AI 默认（平台兜底）

「全局 AI 默认」tab → 配置 **平台兜底 Key**：
- 用途: FAQ 自动生成、广告变体生成、开场白评分等"内部任务"
- 费用: 平台承担（不消耗租户的 Key）
- 推荐: DeepSeek（成本最低）

## 13.5 用户管理

「用户管理」tab → 平台所有用户：

- **新增用户**: 用户名 / 初始密码 / 角色 / 所属租户
- **改 role**: super_admin / admin / operator / viewer
- **改租户**: 把用户挪到另一个租户
- **重置密码**: 生成 12 位随机临时密码（只显示一次）
- **启用/禁用**: 临时冻结
- **删除**: 不能删自己

四种角色区别：

| 角色 | 权限 |
|---|---|
| **super_admin** | 跨租户全权（不绑租户） |
| **admin** | 租户内全权 |
| **operator** | 租户内日常运营（不能改设置） |
| **viewer** | 只读 |

## 13.6 Prompt 配置（高级）

「Prompt 配置」tab 包含 4 个子标签：

| 子标签 | 用途 |
|---|---|
| AI 客服人设 | 全局 system prompt（所有客服的"性格"基底） |
| 广告变体 Prompt | 广告 AI 生成变体的指令模板 |
| 行业话术 | 各行业的特殊话术注入 |
| 转接话术 | 转人工时给客户发的提示文案 |

每个都可以「**恢复默认**」回到出厂值。

---

# 第 14 章 · 常见问题与故障排查

## 14.1 账号相关

**Q: 账号绑定时收不到 SMS 验证码？**

A:
1. 检查手机号是否能收 TG 系统消息（先用真机 TG App 测试）
2. 检查代理是否正常（去「代理管理」单独测试）
3. 等 5 分钟（TG 有时延迟）
4. 还不行 → 选「**通过 TG App 接收验证码**」走应用内通道

---

**Q: 账号突然 status 变 error，怎么办？**

A:
1. 进「账号 → 该账号详情」看「错误信息」字段
2. 如果是 "AUTH_KEY_UNREGISTERED" → session 被踢，需要重新绑定
3. 如果是 "FloodWait X seconds" → 等隔离期结束自动恢复
4. 如果是代理错误 → 换代理

---

**Q: Health Score 一直在掉怎么办？**

A: 常见原因：
- 发送频率太高 → 降低 Campaign 间隔
- 文案重复度太高 → 用 AI Variant 增加 N 倍变体
- 群发垃圾群 → 用「群源发现」改用高质量群源
- 账号本身有历史风险 → 重新养 7 天 / 换号

## 14.2 Bot 客服相关

**Q: Bot 收到客户消息但没回复？**

A: 排查顺序：
1. 「**系统维护 → Bot 长轮询自检**」看 token 是否有效、心跳是否新
2. 检查回复模式是不是 `off`
3. 检查 AI Key 是否配置（smart 模式必需）
4. 检查 FAQ 是否有命中（faq 模式）
5. 还不行 → pm2 restart telehubx-server

---

**Q: AI 回复很慢（超过 10 秒）？**

A:
1. 看 AI Provider 是否被限流（DeepSeek 高峰期会慢）
2. 知识库切片太多 → 检索耗时长 → 减小知识库或换更强模型
3. 网络问题 → 看 server 日志是否有 timeout

## 14.3 任务相关

**Q: 任务一直 pending 不执行？**

A:
1. 看 agent 进程: `pm2 status` → telehubx-agent 是否 online
2. 看账号 status：执行账号必须 online
3. 看 scheduledAt：是否未来时间
4. 看代理：代理失效会导致 agent 拉不起任务

---

**Q: Campaign 发了一半失败一堆？**

A:
1. 进 Campaign 详情 → 看失败任务的 errorMsg
2. 多数是 "FloodWait" → 账号被限流，减小并发
3. 部分是 "Could not find input entity" → 群组已解散或 username 失效
4. 用「**系统维护 → 失败任务诊断**」一键重试网络类、忽略目标失效类

## 14.4 性能相关

**Q: 页面加载慢？**

A:
1. 浏览器 Ctrl+Shift+R 强制刷新清缓存
2. 看网络面板看哪个 API 慢
3. 候选人池数据 > 5 万行时建议加筛选条件
4. 联系平台 / 检查 server / DB 状态

---

**Q: WebSocket 实时消息收不到？**

A:
1. 看浏览器右下角 socket 状态指示
2. 重新登录刷新 JWT
3. 看「人工接管」页 socket badge：绿色 = 已连接
4. 防火墙 / 公司网络可能阻塞 WebSocket → 联系网管

## 14.5 紧急处理

**🚨 全部账号同时掉线**:

1. 立即检查 agent: `pm2 status`
2. 查看 agent 日志: `pm2 logs telehubx-agent --lines 100`
3. 重启 agent: `pm2 restart telehubx-agent`
4. 等 30 秒看 agent 是否能重新连上账号
5. 仍不行 → 联系技术支持

**🚨 数据看起来丢了**:

数据**永远不会真丢**。可能原因：
1. 切换租户了 → 顶部租户名是不是别的租户
2. 浏览器缓存问题 → Ctrl+Shift+R
3. 时间筛选没设对 → 调宽时间范围
4. 联系技术支持查 PostgreSQL 备份

---

# 附录 A · 关键术语表

| 术语 | 含义 |
|---|---|
| **Tenant（租户）** | 平台上的一个独立客户单位，数据完全隔离 |
| **Account（账号）** | 一个 Telegram 账号（真实手机号） |
| **Bot** | Telegram 机器人，客户消息入口 |
| **Lead** | 一段客户对话，从首次消息到关闭算一个 Lead |
| **Candidate（候选人）** | 从群里爬到的潜在客户，未触达过 |
| **Campaign** | 一次广告投放计划 |
| **Warmup** | 7 天养号流程 |
| **FAQ** | 关键字匹配回复 |
| **KB（知识库）** | RAG 检索的文档库 |
| **Health Score** | 账号健康分 0-100 |
| **FloodWait** | TG 频率限制错误，需等待解除 |
| **MTProto** | TG 客户端协议（用户号用） |
| **Bot API** | TG 公开 HTTP 接口（Bot 用） |

# 附录 B · 推荐操作时间表

| 时段 | 任务 | 备注 |
|---|---|---|
| 09:00-11:00 | 看仪表盘 / 处理人工接管池积压 | |
| 11:00-12:00 | 检查 Campaign 进度 | |
| 14:00-15:00 | 群源发现 / 候选人挑选 | 中午 TG 用户活跃 |
| 17:00-18:00 | 复盘当日数据 / 调整次日计划 | |
| 22:00 后 | 减少主动触达 | 夜间显得过于自动化 |

# 附录 C · 联系支持

- **技术工单**: support@telehubx.com
- **紧急 Telegram**: @TeleHubX_Support
- **官方文档**: https://docs.telehubx.com
- **状态页**: https://status.telehubx.com

---

<div style="text-align:center; margin-top:40px; color:#999; font-size:10pt;">
本指南随产品迭代持续更新，请定期访问官方文档获取最新版本。<br/>
<b>TeleHubX</b> · © 2026 · 版本 v1.0
</div>
