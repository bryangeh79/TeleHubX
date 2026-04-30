# WAhubX → TeleHubX 页面对照表

> 用途：决定哪些页面/Card/按钮需要照搬到 TeleHubX，哪些要适配，哪些要跳过。
> 标记：✅ 直接复刻 · 🟡 需适配（含 TG 差异）· 🔴 不做（WA 独有）· 🆕 新增（TG 独有）· ✔️ TeleHubX 已有
> 生成日期：2026-04-30

---

## 一、侧边栏总览

| WAhubX 菜单项 | TeleHubX 当前 | 建议 |
|---|---|---|
| 仪表盘 | ✔️ Dashboard | 内容差距大，✅ 复刻 |
| 账号槽位 | ✔️ Accounts | 命名建议改"账号槽位"，🟡 加 slot 卡片视图 |
| 任务调度 | ❌ 无 | 🆕 新建（TeleHubX 当前没有统一调度页） |
| 广告投放 | ✔️ Campaigns | 🟡 改名"广告投放"，加 KPI + 4 步向导 |
| 智能客服 | ✔️ /cs（部分） | 🟡 已有骨架，缺 wizard / 4-tab 完整版 |
| 人工接管 | ✔️ /leads（雏形） | 🟡 升级为带 socket 的实时聊天窗 |
| 设置 | ✔️ /ai + /proxies + /knowledge 散落 | 🟡 合并为统一"设置中心"含子菜单 |
| 管理面板（Admin） | ❌ 无 | 🆕 新建（用于平台/Super Admin）|
| — | ✔️ Knowledge（独立菜单） | 🟡 合并到智能客服里（WAhubX 也是这么做的） |
| — | ✔️ Warmup（独立菜单） | 🟡 合并到 Accounts 详情页 tab 里 |
| — | ✔️ Leads | 🟡 改名"人工接管" |

**建议侧边栏（最终目标）：**
```
仪表盘 / 账号槽位 / 任务调度 / 广告投放 / 智能客服 / 人工接管 / 频道运营🆕 / 设置 / 管理面板
```

---

## 二、页面级对照（重点）

### 1. 仪表盘 `/`

| WAhubX Card / 元素 | TeleHubX 当前 | 状态 |
|---|---|---|
| 系统状态卡（Backend/DB/Auth/License）4 个渐变 pill | 4 个简单 stat card | 🟡 改造样式 + 加状态指示灯 |
| 任务队列卡（Running/Pending/Failed + SVG 图）| 无 | ✅ 加上（依赖任务调度页先建）|
| 版本号 + uptime 页脚 | 无 | ✅ 加 |
| Refresh 按钮 | 有 | ✔️ |

---

### 2. 账号槽位 `/slots` (WAhubX) ↔ `/accounts` (TeleHubX)

| WAhubX 元素 | TeleHubX | 状态 | 备注 |
|---|---|---|---|
| 槽位分布进度条（warmup/active/suspended/quarantine/empty）| 无 | ✅ 加 |  |
| 网格 Card 视图（每号一卡：状态 pill + 健康指示 + 电话 + 角色）| Table 视图 | 🟡 加 Card 视图作为 toggle 选项 |  |
| 槽位编号 No.1/No.2 显示 | 有（slotNo 列）| ✔️ |  |
| 健康指示器 🟢🟡🔴⚪ | healthScore 数字 | 🟡 改成颜色点 + tooltip |  |
| 操作下拉：Edit/Chat test/Export/Health checkup/Quick recover/Change number/Delete | 仅 Edit/Delete | 🟡 加更多动作 |  |
| Bind 模态：扫 QR | TG 是手机+OTP | 🟡 已实现（BindWizard）|  |
| Select Proxy 模态 | 有 | ✔️ |  |
| Chat test 模态 | 无 | ✅ 加（拿 Bot 给自己发条测试消息） |  |
| SIM info 模态（单 + 批量）| 无 | 🔴 跳过（TG 不需要 SIM 概念） |  |
| Health checkup 模态 | 无 | ✅ 加 |  |
| Recovery 模态 | 无 | ✅ 加 |  |
| Change number | 无 | 🟡 改名"切换 session" |  |

---

### 3. 任务调度 `/scheduler` (WAhubX) ↔ ❌ 无 (TeleHubX)

整页 🆕 新建。

| WAhubX 元素 | 复刻建议 |
|---|---|
| 4 个 KPI（Total/Running/Pending/Done）| ✅ 直接复刻 |
| Task 表格 + 过滤（Status/Type/Search）| ✅ |
| 20+ 任务类型分 5 类 | 🟡 任务类型枚举要换成 TG 版：Warmup, ChatScript, 单条消息, 群发, 浏览频道, 加群, 加频道, 给消息加 reaction, idle keepalive |
| Create task 模态（按类型动态表单）| ✅ |
| Warmup 计划子区 | ✅ |

**注意**：TeleHubX 后端目前没有统一 task 表，需要先建 `tasks` entity（可参考 WAhubX 的 task scheduler 模块）。

---

### 4. 广告投放 `/ads` (WAhubX) ↔ `/campaigns` (TeleHubX)

| WAhubX 元素 | TeleHubX | 状态 |
|---|---|---|
| 4 个 KPI（All/Running/Draft/Done）| 无 | ✅ 加 |
| 顶部 Action 菜单：广告文案 / 开场白 | 无 | ✅ 加 |
| Campaign 表（含 Safety status 列）| 表（无 Safety）| 🟡 加安全状态列 |
| **CreateCampaignModal 4 步向导** | 单页表单 | 🟡 改成向导 |
| CampaignDetailDrawer | 无 | ✅ 加 |
| AdvertisementDrawer（广告库）| 无 | ✅ 加 |
| OpeningLineDrawer（开场白库）| 无 | ✅ 加 |
| CustomerGroupDrawer（客户分组）| 无 | 🟡 TG 改成"目标群组列表"|
| CustomerGroupImportModal（CSV 导入目标）| 无 | ✅ 加 |

**TG 适配**：发送通道选项要从 WA Web 改成 MTProto（已是这样了），目标支持"用户列表"和"群组成员爬取"两种来源。

---

### 5. 智能客服 `/reply` (WAhubX) ↔ `/cs` (TeleHubX)

| WAhubX Card | TeleHubX | 状态 |
|---|---|---|
| 顶部「Setup wizard」按钮 | 无 | ✅ 加（3 步：上传文档→AI 生成 FAQ→选模式）|
| 配置警告 Alert（mode=off / 无 defaultKbId / 无产品 KB）| 仅基础 alert | 🟡 加智能检测 |
| CS 槽位绑定信息 Card | 无（已用 Bot）| 🟡 改成"Bot 绑定信息"（已部分实现）|
| Empty State「3 步搞定」入口 | 无 | ✅ 加 |
| **ReplyModeCard 三档**（off/FAQ/smart）+ 确认弹窗 | ✔️ 已实现 | ✔️ |
| **4-Tab 主区**（概览 / 知识库 / 高级设置 / 保留）| 3-Tab（无概览）| 🟡 加概览 tab，并把"知识库"从独立菜单合并进来 |
| KB CRUD + 子 3 tab（FAQ List / Sources / Protected）| ✔️ 已实现 | ✔️ |
| 高级设置：daily limit / cooldown / takeover threshold / AI confidence | 仅文字说明 | 🟡 改成可编辑表单 |
| 底部 Alert（自动回复行为）| ✔️ | ✔️ |
| ReplySetupWizard 模态（3 步）| 无 | ✅ 加 |

---

### 6. 人工接管 `/takeover` (WAhubX) ↔ `/leads` (TeleHubX)

| WAhubX 元素 | TeleHubX | 状态 |
|---|---|---|
| 槽位选择下拉（CS 优先、在线优先）| 无 | 🟡 改成"对话列表"（按 lead.tgChatId）|
| **TakeoverEmbeddedWindow** 嵌入聊天界面（实时）| 无（仅 Lead 列表 + reply 按钮）| 🔴 重做：TG 这边走 Bot WebSocket，不是嵌入 WA Web |
| CustomerArchivePanel 客户档案侧栏 | 部分（Lead 详情）| 🟡 升级 |
| Release 按钮（释放锁）| 有（release）| ✔️ |
| sessionStorage 持久化 | 无 | ✅ 加 |
| 60s 心跳 / 30min 后端超时 | 无 | ✅ 加（C2 待办）|

**TG 关键差异**：WAhubX 的 takeover 是把 Chromium 的 WhatsApp Web 嵌入页面让人工直接操作；TG 没有 Web 客户端可嵌。要改成**自建聊天界面 + WebSocket → BotGateway → sendMessage**。这就是 C2 任务。

---

### 7. 设置中心 `/settings` (WAhubX) ↔ 散落多页 (TeleHubX)

WAhubX 把所有"配置类"合并到一个页面带左侧子菜单。建议 TeleHubX 也合并：

| WAhubX 子菜单 | TeleHubX 当前位置 | 建议 |
|---|---|---|
| 租户信息 | 无独立页 | ✅ 加 |
| License 管理 | 无独立页（后端有）| ✅ 加 |
| 用户管理 | 无 | ✅ 加 |
| Assets 资源库（图/视频/语音/文件）| 无 | ✅ 加 |
| **AI 配置（多 provider tab）** | ✔️ /ai | ✔️ 已有（这次刚做完双层 key）|
| **代理管理** | ✔️ /proxies | ✔️ 整页移过来 |
| 系统维护（备份/恢复/日志）| 无 | ✅ 加 |
| 关于 | 无 | ✅ 加 |

---

### 8. 管理面板 `/admin` 12 Tab (WAhubX) ↔ ❌ 无 (TeleHubX)

整个 🆕 新建。这是 Super Admin 专用，平台运营视角。

| Tab | 复刻建议 |
|---|---|
| Tenants 列表 CRUD | ✅ 直接做 |
| Licenses CRUD + verify | ✅ 后端 Wave 3 已建 |
| Users 全局管理 | ✅ |
| Scripts 上传（对话剧本） | 🟡 接 chat-scripts 模块 |
| Assets 全局库 | ✅ |
| Warmup plans 模板（P0-P3）| ✅ |
| AI config 全局 | ✅（PLATFORM_* 状态展示）|
| **Health scoring**（评分细则 + 7 天趋势）| ✅ 加 |
| Takeover 设置（每槽位配置）| 🟡 改"每 Bot 配置"|
| Backup 每日快照 | ✅ |
| Upgrade 版本管理 | ✅ |
| Task queue 状态 | ✅ |

---

## 三、TG 独有候选（🆕 WAhubX 没有，TG 应该有）

| 功能 | 说明 | 优先级 |
|---|---|---|
| **频道运营**（Channels）| TG 频道是核心增长渠道，WA 完全没有等价物 | 高 |
| **Bot 管理**（多 Bot 切换、回调按钮、命令编辑器）| 已雏形在智能客服，建议独立 | 中 |
| **Reactions 数据**（消息反应数统计）| TG 互动信号 | 中 |
| **InlineKeyboard 编辑器**（可视化按钮设计）| Bot 高级功能 | 低 |
| **群组爬取**（提取群成员作为 Campaign 目标）| TG 玩法核心 | 高 |

---

## 四、TeleHubX 已有但 WAhubX 没有的页

| TeleHubX | 备注 |
|---|---|
| `/ai` 独立 AI Settings | 建议合并到设置中心，但 WAhubX 也是合并的，所以这是名义差异 |
| `/knowledge` 独立 | 建议合并到智能客服 tab |
| `/warmup` 独立 | 建议合并到 Accounts 详情 tab |
| `/leads` | 等同于 WAhubX 人工接管，改名 |

---

## 五、推荐复刻顺序（按价值/工作量比）

### Wave 1（4 周内可完成，价值最高）
1. **任务调度页 `/scheduler`** 🆕 — 平台稳定性的中枢，后端要先建 task 表
2. **人工接管升级 `/inbox`** 🟡 — 把 Leads 改成实时聊天，配套 C2 WebSocket 桥
3. **智能客服 wizard + 概览 tab** 🟡 — 现有页面增量
4. **设置中心合并** 🟡 — 把 /ai /proxies 合到一页

### Wave 2（拉开和 WAhubX 同等水平）
5. **广告投放 4 步向导 + Drawers** 🟡
6. **管理面板 `/admin`** 🆕 — Super Admin 视图
7. **账号槽位 Card 视图 + 更多操作** 🟡

### Wave 3（TG 独有增值）
8. **频道运营** 🆕
9. **群组爬取**（Campaign 目标来源） 🆕
10. **Reactions 统计** 🆕

---

## 六、需要你拍板的关键决策

1. **侧边栏菜单结构**：按建议合并 `/ai` `/knowledge` `/warmup` `/proxies` 到「设置中心」+「智能客服」+「Accounts 详情 tab」？
2. **任务调度页**：先建后端 `tasks` entity 还是先做前端骨架（先 mock 后填）？
3. **人工接管**：保留 `/leads` 路径还是改名 `/inbox`？
4. **管理面板访问权限**：仅 SUPER_ADMIN 看到？（影响 sidebar 渲染逻辑）
5. **频道运营**优先级：和"群组爬取"二选一先做？

填好这五个决策，我就可以从 Wave 1 第一项动手。
