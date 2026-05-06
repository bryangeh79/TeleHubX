# TeleHubX — 会话交接 (2026-05-06)

> 给下一个 Claude Code 会话：读完这一份 + CLAUDE.md 第七节，即可无缝接手。
> 上一轮会话主要做了 **wedged GramJS client 修复 + 租户自助重置按钮 (T1) + WarmupPage UI 重构 + i18n 修复**。
> 从 commit `2a8eee3` 到 `2e2f5cf`，~7 个 commit。

---

## 0. 立刻执行（开机后第一件事）

```bash
cd "C:\AI_WORKSPACE\Telegram Auto Bot"
git log --oneline -10         # 看最新 commit
pm2 status                    # 确认 server / agent / dashboard 都 online
docker ps                     # telehubx-pg + telehubx-redis 是否在跑
```

期待：3 个 pm2 进程 online，2 个 docker 容器健康。如有问题先 `Start-TeleHubX.bat`。

---

## 1. 当前最新状态 (HEAD)

```
HEAD = 2e2f5cf (chore: 从仓库剔除本机特定文件)
分支 main，本地已 commit；用户暂未确认是否 push GitHub
```

**本轮关键交付（最新 → 最旧）**：

| Commit | 内容 |
|---|---|
| `2e2f5cf` | .gitignore 加 `data/cloud-license.bin` `data/machine-fingerprint.txt` `.claude/` |
| `29e0874` | **T1 重置按钮**：AccountsPage 行内「⚡ 重置连接」+ server endpoint + agent 标志位轮询 |
| `f4f02f6` | **修 wedged client 根因**：reconnectAccount 改为销毁旧 client + 用同 session 新建 + 新增 probe-account.ts 诊断脚本 |
| `6d7567e` | SchedulerPage 任务类型下拉跟随语言切换 + WarmupPage 手机号字号放大 |
| `722fa7e` | WarmupPage 重构 UI 还原 GPT 设计稿（统计卡 + 阶段侧栏 + 健康圆环 + 已完成行高亮）|
| `a8903e6` | 移除 SchedulerPage 重复"长任务"面板 + WarmupPage 加查看子任务进度按钮 |
| `2a8eee3` | WarmupPage preset 任务加暂停/恢复/取消按钮 + 子任务级联 |

---

## 2. 重要技术发现（务必记住，否则会再次踩坑）

### 2a. GramJS 长跑客户端会 wedge

**症状**：`Error: TIMEOUT` 在 `_updateLoop` 喷涌，所有 `client.invoke()` 卡 60s 超时，但 socket 看起来连着。

**根因**：GramJS TelegramClient 的内部状态（update loop / msg_seqno / pending RPC buffer）累积错误后无法靠 `disconnect()+connect()` 复用同实例恢复。

**正确修法**（已实现于 `apps/agent/src/main.ts:450-498` `reconnectAccount`）：
1. `disconnect(id)` 销毁旧 slot 实例
2. fetch 最新 account row（拿最新 proxy / fingerprint）
3. `connect(fresh)` 走完整流程 → new TelegramClient + 重挂所有 handler

**证据**：probe-account.ts 4 组对照实验显示新 client 200ms 全 RPC 健康，老 client 全卡 60s。

**红线**：不要回退到只 disconnect+connect，那等于没修。原本的注释"只允许 disconnect+connect, 不允许 new TelegramClient"已被实证证伪。

### 2b. HTTP 代理已有 SOCKS5 桥接

**别再误报"HTTP 代理不能 MTProto"** — `apps/server/src/proxies/http-to-socks5.bridge.ts` + `proxies.service.ts:183-224 toGramConfig()` 自动起本地 SOCKS5 桥接。Agent 调 `/proxies/:id/gram-config` 拿到的可能是 `127.0.0.1:bridgePort`。HTTP/HTTPS/SOCKS5 三种代理类型对 agent 透明。

### 2c. 广告号自动回复策略（产品行为）

- **私聊广告号** → 一律回 divert：「请通过 @{bot} 联系」
- **群里 @ 广告号** → 回 FAQ
- **群里普通消息（不 @）** → 不响应（防刷屏）
- **chat_script_* 期间** → 参演的 4 个号被 `mutedAccounts.set(id)` 全部静默，`finally{}` 解 mute（详见 `executors.ts:1230-1241`）。**这意味着剧本 5-15 分钟期间真客户的私聊/@也会被丢弃**。用户已知并接受现状。

代码位置：`apps/agent/src/telegram/message-handler.ts:85-88` (mute 检查) + `:155-176` (handleAdMessage) + `apps/agent/src/tasks/script-mute.ts`

---

## 3. 诊断工具（永久收纳）

### probe-account.ts — RPC 健康探针

位置：`apps/agent/src/scripts/probe-account.ts`

用法：
```bash
cd apps/agent
./node_modules/.bin/tsx src/scripts/probe-account.ts --phone +447746513981
./node_modules/.bin/tsx src/scripts/probe-account.ts --phone +xxx --proxyId <uuid>
./node_modules/.bin/tsx src/scripts/probe-account.ts --phone +xxx --noProxy
```

输出 JSON 报告：connect 耗时 + 4 个核心 RPC（UpdateStatus / GetConfig / ResolveUsername / GetDialogs）每条耗时和错误。

**用于诊断"某账号在 agent 里跑不动但不知道哪一层"**：
- 全绿 → 不是账号/session/代理/bridge/DC 问题，是 agent 持有的长跑 client wedge → 用 T1 按钮重置
- 全红 → 真的是底层（账号被封 / 代理崩 / 网络断）
- 部分红 → 看哪几个 RPC 失败定位（如只 ResolveUsername 失败 = 跨 DC 问题）

---

## 4. 租户自助修复 (T1) — 怎么用

**触发路径**：AccountsPage → 占用账号行 → 点「⚡ 重置连接」按钮 → Popconfirm 确认 → 弹 toast "重置请求已发送（约 30 秒内执行）"

**幕后**：
1. POST `/accounts/:id/reset-connection`（租户 JWT，带租户隔离）
2. server 设 `accounts.resetRequestedAt = NOW()`
3. agent 下次 `syncFromDb` 轮询（最多 30s）看到 `resetRequestedAt > slot.connectedAt`
4. 触发 `disconnect(id) + connect(fresh)` 销毁老 client + 用同 session 新建
5. 时间戳幂等：`connectedAt` 自动 > 老 `resetRequestedAt`，连点不会反复重连

**i18n**：5 keys × 4 langs（zh/en/ms/vi）`account.btnResetConn` / `resetConnConfirm` / `resetConnDesc` / `resetConnSent` / `resetConnTip`

---

## 5. 验证战绩 (+447746513981 修复前后)

| 阶段 | 任务情况 |
|---|---|
| 修复前 24h | 0 done / 22 fail（全 RPC timeout）|
| 修复后第一组 | idle_keepalive #166 ✅ 0.2s |
| | browse_channel #167 ✅ 108s（ResolveUsername 通过）|
| 上 4 人剧本 | chat_script_4p #168 ✅ 9m36s |
| 再来一场 | chat_script_4p #169 ✅ 6m41s |

**结论**：修复彻底，wedge 不再发生。+447 已可参与任何任务。

---

## 6. 未尽事项 / 已知缺口（优先级排序）

### 未做但已论证

| # | 项目 | 现状 | 触发条件 |
|---|---|---|---|
| T2 | Watchdog 自动自愈 | 没做 | KeepOnline 连续 N 次 timeout 自动 reset |
| T3 | RPC 健康度列 | 没做 | AccountsPage 加"近 1h 任务成功率"彩色 Tag |
| T4 | 定期预防 recycle | 没做 | 每 N 小时主动重建 client（Tier 4 防御）|

T2/T3 上一轮 plan 里讨论过，用户选了"先 T1，看效果再决定"。

### 待清理

| # | 问题 | 风险 |
|---|---|---|
| 1 | commit `29e0874` 的 git 历史里有 `data/cloud-license.bin` + `machine-fingerprint.txt` 字节 | 推 GitHub 后泄漏。需要 `git rebase -i HEAD~2` + force push 才能彻底清。用户尚未决定是否 force push。文件已被 .gitignore + git rm --cached |
| 2 | 任务 #98 / #133 / #164 / #165 历史失败 | 都是修复前的"假死"，不需要重试，留作 audit |

### 跑路前必备

无。本轮工作全部 commit 完毕，3 个 pm2 进程 online，DB 健康，账号 +447 修好。

---

## 7. 可能踩坑提醒

### 7a. WarmupPage 已大改，跟旧 README/截图对不上

新设计：
- 顶部 4 张统计卡（全部账号 / 运行中 / 尚未启动 / 已完成 + 百分比）
- 左侧 P0-P4 阶段说明侧栏（5 个彩色圆点 + 提示卡）
- 右侧表格列：编号 / 手机号(+复制) / 角色 / 账号状态(含已完成 Tag) / 阶段 & 进度(Day X/7 + 进度条) / 健康分(圆环) / 开始时间 / 操作(全图标)
- 已完成行整行淡绿底
- preset 任务有「📋 查看子任务进度」按钮 → 弹 Modal 显示父任务详情 + 子任务时间线（5s 轮询）

入口：DashboardLayout 顶部菜单加了「🌱 养号」(`FireOutlined`) 在「账号」和「任务调度」之间。

### 7b. SchedulerPage 已删「运行中的长任务」蓝色面板

preset_* 任务现在统一在 WarmupPage 看 + 操作。SchedulerPage 表格仍然显示所有任务（包括 running/paused 的 preset），可用类型筛选过滤。

### 7c. SchedulerPage 任务类型下拉曾经只显示英文

已修：`buildGroupedTaskOptions()` 加 `t` 参数 + 8 个新 `taskGroup.*` keys × 4 langs。

### 7d. agent 重启后 +447 connect 显示新 proxy port

每次重启 HttpToSocks5Bridge 会分配新本地端口（如 `127.0.0.1:56298`）。这是正常现象，不是 bug。

---

## 8. 开发常用速查（摘 CLAUDE.md）

### 端口
| 服务 | 端口 |
|------|------|
| Backend (NestJS) | 9800 |
| Dashboard (Vite) | 9601 |
| PostgreSQL (Docker) | 5436 |
| Redis (Docker) | 6386 |

### Build
```bash
# 整套
cd apps/server && pnpm build
cd apps/agent && pnpm build
cd apps/dashboard && pnpm build

# 重启
pm2 restart telehubx-server telehubx-agent telehubx-dashboard
```

### DB 速查
```bash
# 任务状态
docker exec telehubx-pg psql -U telehubx -d telehubx -c \
  "SELECT seq, type, status, \"errorMsg\" FROM tasks ORDER BY seq DESC LIMIT 10;"

# 账号代理
docker exec telehubx-pg psql -U telehubx -d telehubx -c \
  "SELECT a.\"phoneNumber\", p.name, p.type, p.country FROM accounts a LEFT JOIN proxies p ON p.id=a.\"proxyId\";"
```

### Agent 日志过滤模板
```bash
# 看某账号最近活动
pm2 logs telehubx-agent --lines 100 --nostream --raw 2>&1 | grep -aE "<phone>|<accountIdPrefix>"

# 看 RPC TIMEOUT 喷涌
pm2 logs telehubx-agent --lines 200 --nostream --raw 2>&1 | grep -aE "TIMEOUT|RPC timeout"

# 看 reset/reconnect 事件
pm2 logs telehubx-agent --lines 200 --nostream --raw 2>&1 | grep -aE "\[reset\]|\[reconnect\]|\[connect\]"
```

---

## 9. 上一轮会话归档

之前的 HANDOFF.md (2026-05-03) 已被本文件覆盖。如需查阅旧版本：

```bash
git show HEAD~10:HANDOFF.md     # 大致回到 5-03 那版（数字按需调整）
```

或在 GitHub 历史里看。

---

**新会话开始时记得：**
1. 读这份文件（你正在读）
2. 读 `CLAUDE.md` 第七节"当前进度"
3. `pm2 status` + `git log --oneline -5` 确认环境
4. 然后从用户最新指令接手即可
