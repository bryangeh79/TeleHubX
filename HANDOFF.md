# TeleHubX — 会话交接 (2026-05-01)

> 给下一个 Claude Code 会话: 读完这一份 + CLAUDE.md 第七节, 即可无缝接手.
> 上一轮会话从 c52547f 一直工作到 4f3ef4a, 期间 push 30+ commit. 下面是状态快照.

---

## 0. 立刻执行 (开机后第一件事)

```bash
cd "C:\AI_WORKSPACE\Telegram Auto Bot"
git log --oneline -10        # 看上一轮最新 commit
pm2 status                   # 确认 server / agent / dashboard 都 online
docker ps                    # telehubx-pg + telehubx-redis 是否在跑
```

期待: 3 个 pm2 进程 online, 2 个 docker 容器健康. 如有问题先 `Start-TeleHubX.bat`.

---

## 1. 当前最新状态 (HEAD)

```
HEAD = 4f3ef4a (ui 多天父任务永远显示进度条)
分支 main, 已推 GitHub
```

**架构层完整可用**:
- 22 类任务全部建模 ✓
- 22 类任务全部有 dashboard 表单字段 ✓
- 22 类任务的 executor: **17 / 22 落地** (剩 5 个在第 4 节)
- 任务编排器 (preset_*, keyword_lead_hunt) 全部展开成多日子任务 ✓
- 父子任务进度自动汇总 ✓
- 候选人池 (LeadCandidate) 富字段已就绪 ✓

---

## 2. 上一轮做的核心改动 (按时间倒序)

| 类别 | 描述 |
|---|---|
| 立即终止/强制停止 | 任务列表头部「⏹ 立即终止全部」按钮 + 单条 cancel |
| chat_script 重构 | 1 任务 1 行 (不再拆 N 子任务), agent 端协调多账号切 client |
| ownNetwork 白名单 | 防 chat_script 让两本租户号互回 FAQ-loop (Account 加 tgUserId, agent 启动时自动 backfill) |
| Auto-import contact | 私聊前自动加对方为联系人 (含陌生人手机号) |
| 节奏调快 | send_delay 30-90s → 10-40s |
| 30 个新 AB 剧本 + 50 个新 4P | 自然中文 + emoji, 替换 WAhubX 100 个机器感 (旧的存到 archived/) |
| 媒体任务表单 | 接收方 (内池/外部) + 素材 (随机/指定) + caption |
| seq 自增 + 最新在上 | 任务 ID #1 #2 #3, createdAt DESC |
| 详情 Modal 全人话 | 不再渲染 JSON, 按 type 分支渲染 KV; humanizeError 翻译技术错误 |
| PRESET orchestrator | warmup_7d (D1-7 真实 P0-P4 节奏) / rampup_7d / full_14d / mature_ops (D15+ 维持) |
| KEYWORD_LEAD_HUNT v2 | 纯候选人收集, 3 输入 (keywords / target / days), 自动节奏, seedGroups 优先 |
| LeadCandidate 富字段 | sourceGroupTitle / phone / lastSeenAt / isPremium / isBot / huntTaskId |
| join_groups_by_keyword executor | 关键词搜群+加, contacts.Search + 过滤宽松 |
| 父任务进度汇总 | 子任务变化反推父 status/progress, 多天任务永远显进度条 |
| 22 task 详细表单 | TaskTypeFields 组件 + buildPayloadForTaskType |
| 删除幂等 + 级联 | remove() 找不到不抛错, 删父连同所有子任务 |

---

## 3. 数据库现状 (重要)

### 表
- `tasks`: 父子结构 (parentTaskId 链), seq 自增展示 ID, payload jsonb
- `lead_candidates`: 富字段, huntTaskId 链到 keyword_lead_hunt 父
- `assets`: 405 builtin (磁盘 712 MB) + 任意 tenant 上传
- `chat_scripts`: 30 AB + 50 4P, 全中文 (WAhubX MY 包已存档)
- `accounts`: tgUserId 字段已加, 3 个号自动 backfill 完成

### 关键字段
- `Task.parentTaskId` — preset/keyword_lead_hunt 父子关联
- `Task.seq` — BIGSERIAL 自增 (生产用), 不是业务 id
- `Task.payload` — 各任务独立 schema (见 task.entity.ts 注释)
- `LeadCandidate.huntTaskId` — 从哪次 keyword_lead_hunt 爬来的
- `Account.tgUserId` — TG 数字 user id, 用于 ownNetwork 白名单

### 运行环境
- DB: `localhost:5436` (telehubx / telehubx)
- Redis: `localhost:6386`
- Server: `http://localhost:9800/api/v1`
- Dashboard: `http://localhost:9601`
- AGENT_TOKEN: 见 `.env` (agent ↔ server 鉴权)
- JWT_SECRET: 见 `.env`

---

## 4. 已知未实现 / 已知 bug (新会话注意)

### 未实现的 executor (5/22)

| 任务类型 | 现状 | 影响 |
|---|---|---|
| `accept_invites` | 表单有, executor 没有 | 用户点确定 → "No executor registered" |
| `group_create` | 表单有, executor 没有 | 同上 |
| `group_invite_members` | 表单有, executor 没有 | 同上 |
| `keyword_lead_hunt` 阶段 B | parent 是 orchestrator (展开正常), 但 D2+ 子任务的 group_scrape `dynamicSource: 'recent_joins'` sentinel 没在 agent 端实现 | 跑到 D2 爬群任务, payload.tgChatIds 是 [] → 抛错 "tgChatIds 为空" |

### 已知 bug

1. **keyword_lead_hunt 阶段 B 爬群会失败**:
   - 原因: payload.tgChatIds 空 (sentinel 'recent_joins'), groupScrape executor 检查到空就抛错
   - 修法: 在 agent groupScrape 入口加: 如 `payload.dynamicSource === 'recent_joins'`, 调 `client.getDialogs()` 拿最近 14 天加的 megagroup, 用作 tgChatIds
   - 文件: `apps/agent/src/tasks/executors.ts` 内 `groupScrape` 函数开头

2. **关键词「外汇」搜不到群**:
   - 中文搜索结果稀疏, contacts.Search 经常空数组
   - 已在 0398900 放宽过滤 (含 unknown member count), 但还是看运气
   - 解决: 用户用 seedGroups 字段填具体群 id 兜底

3. **group_scrape 内池号接收 vs 外部 phone 仍可能 PEER_ID_INVALID**:
   - 已加 isPhoneFormat() + tryImportContact(), 但 TG 用户隐私"不允许通过手机号查找" 仍会失败
   - 这是 TG 协议限制, 系统已优雅报错

---

## 5. 用户最近的设计决策 (会话上下文)

1. **关键词智能引流定位**: 纯候选人收集管线 (不含触达). 3 输入: keywords / targetCandidates / durationDays. 系统按 (target / 天数) 自动算每天加几群, TG 安全线 ≤ 2 群/天.

2. **指定群优先**: 用户可填 seedGroups[]. 系统先从指定群拉, 不够才用关键词搜公开群补足. 估算 seedYield = N × 30 候选/群.

3. **目标驱动 vs 时间驱动**:
   - 任一目标先达 → 父任务 done (剩余子任务 cancel)
   - 总天数到期 → 父任务 done
   - 用 `checkAndCompleteHunt()` 在 dispatch 前检查

4. **AI 优化对话开关**: chat_script_ab/4p 表单有 `aiOptimize` checkbox, 但 executor 端**还没实现** (走 content_pool 随机抽变体, 没经 AI rewrite). 用户暂未抱怨.

5. **触达职责拆分**: 不再放在 keyword_lead_hunt 内, 由 CONTACT_ADD / CAMPAIGN_SINGLE 单独跑, 从 lead_candidates 池抽人.

6. **多任务并行警告**: 用户问过"同号正在跑 lead_hunt 能否叠其他任务?" 我答可以但有 4 个风险 (TG 配额累计 / 行为画像异常 / 健康度 / chat_script 时间撞). 用户**没要求做防呆 UI**, 自己控制.

7. **任务详情精简**: 用户多次要求拿掉冗余说明 / Alert 块. 不要主动加任务说明文字.

---

## 6. 用户偏好 / 沟通风格 (重要)

- **直接干, 别问**: auto mode 一直开. 用户说 "执行" / "开干" / "继续" 就立刻动手.
- **PDF 是真理**: `TeleHubX 自动化任务说明书.pdf` 是用户认可的设计规格. 实现偏离 → 用户会抓出来.
- **说人话不说技术**: 错误信息 / 任务详情 / 表单 extra 都要中文 + 业务语言. 不要暴露 JSON / UUID / 错误码.
- **不要罗嗦**: 答完 + 下一步建议 + 短. 长篇大论用户烦.
- **每次 commit + push**: 即时同步 GitHub. push 失败她能看见.
- **不许偷懒**: 我曾经把 buildMatureOps7d 等于 buildRampup7d, 用户立刻发现并质问. 别敷衍.
- **截图调试节奏**: 用户多次截图 → 我立刻查 DB + agent 日志 → 发 commit 修复. 这种节奏她习惯了.

---

## 7. 立刻可以做的下一步 (按价值排序)

### A. 修 keyword_lead_hunt 动态目标解析 (用户最近会用 ⭐)

在 `apps/agent/src/tasks/executors.ts` 的 `groupScrape` 函数开头加:

```ts
let chatIds: string[] = (ctx.payload.tgChatIds ?? []) as string[];
if (chatIds.length === 0 && ctx.payload.dynamicSource === 'recent_joins') {
  // 查最近 14 天加的群作为爬取目标
  const dialogs = await ctx.client.getDialogs({ limit: 100 });
  const recent: string[] = [];
  const cutoffSec = Date.now() / 1000 - 14 * 86400;
  for (const d of dialogs) {
    const ent: any = (d as any).entity;
    if (!ent?.megagroup) continue;
    const lastDate = (d as any).message?.date ?? 0;
    if (lastDate >= cutoffSec) recent.push(String(ent.id));
    if (recent.length >= 5) break;
  }
  if (recent.length) chatIds = recent;
  else throw new Error('动态查最近加的群: 找不到, 可能账号还没加过群');
}
```

工时 ~10 分钟. 影响: keyword_lead_hunt 阶段 B 真能跑通.

### B. 实现剩余 4 个 executor (accept_invites / group_create / group_invite_members + dynamic contact_add)

各 ~15 分钟. 完成 22/22.

### C. 中后期工程化 (生产前必做)

- TypeORM migrations (关掉 synchronize:true)
- 多租户行级隔离 (现单 schema, tenantId 列查询)
- License 激活流程前端打通
- agent 端 AI 调用走 tenant.effectiveAiConfig

详见 CLAUDE.md 第 141-152 行.

---

## 8. 常用命令速查

```bash
# 启动
Start-TeleHubX.bat

# pm2
pm2 status
pm2 logs telehubx-server --lines 30
pm2 logs telehubx-agent --lines 30 --nostream
pm2 restart telehubx-server
pm2 restart telehubx-agent --update-env  # update-env 让 agent 读最新 .env

# 编译
cd apps/server  && pnpm build
cd apps/agent   && pnpm build
cd apps/dashboard && pnpm build

# DB
docker exec telehubx-pg psql -U telehubx -d telehubx -c "<SQL>"

# 一次性脚本
cd apps/server
pnpm import:assets   # 重导素材 (带 .gitignore 不进 repo)
pnpm import:scripts  # 重导剧本

# Generators
node apps/server/scripts/generate-ab-pack.js
node apps/server/scripts/generate-4p-pack.js
```

---

## 9. 端口表

| 服务 | 端口 |
|---|---|
| Backend NestJS | 9800 |
| Dashboard Vite | 9601 |
| PostgreSQL Docker | 5436 |
| Redis Docker | 6386 |

---

## 10. 关键设计决策 (用户问过, 别再问)

1. **chat_script 一任务一行**: 不拆子任务. agent 端协调多 client.
2. **preset/keyword_lead_hunt 是 orchestrator**: 父任务展开成 N 个真子任务, 父本身从不被 agent 派发 (dispatch SQL filter `type::text NOT LIKE 'preset_%' AND != 'keyword_lead_hunt'`).
3. **接收方**: 内池号 (本租户账号) vs 外部 (任意 tg id/手机号/username). 内池号靠 ownNetwork 自动 skip 自动回复.
4. **手机号目标必须 import contact**: TG 协议要求, 不是我们的限制. 已自动做.
5. **WAhubX 100 个 MY 剧本已弃用**: 太机器感. 用 30 个新 AB + 50 个新 4P 替代.

---

## 11. 文件位置速查

```
关键代码
  apps/server/src/tasks/tasks.service.ts        — 编排器/dispatch/recalc 父任务
  apps/server/src/tasks/task.entity.ts          — 22 TaskType enum
  apps/server/src/leads-candidates/             — 候选人池
  apps/agent/src/tasks/executors.ts             — 17 个 executor 实现
  apps/agent/src/tasks/server-callback.ts       — agent → server 回调封装
  apps/dashboard/src/pages/scheduler/SchedulerPage.tsx  — 任务调度主页 + 表单
  apps/dashboard/src/pages/leads/LeadCandidatesPage.tsx — 候选池页

关键文档
  CLAUDE.md                                      — 项目背景 (read-only 参考)
  HANDOFF.md                                     — 本文档 (新会话第一站)
  TeleHubX 自动化任务说明书.pdf                  — 22 task 设计规格
  tools/pdf-gen/generate.js                      — 重新生成 PDF 用

数据
  data/assets/                                   — 712 MB 媒体 (gitignored)
  data/script-packs/                             — 5 个 JSON 剧本包
  data/script-packs/archived/                    — 弃用的 WAhubX MY 100 个
```

---

**就这些. 开机后先看 git log + pm2 status + docker ps 确认环境, 然后根据用户首条消息决定干啥. 如果用户没说话, 默认从第 7 节 A (修 keyword_lead_hunt 动态目标解析) 开始.**

—
2026-05-01 完成 90+ commits 长会话, 主要 push 30+ 在 c52547f → 4f3ef4a 区间.
