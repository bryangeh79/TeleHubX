# TeleHubX 生产部署 Checklist

最后更新: 2026-05-04 (Codex round-11)

---

## 1. 环境变量必填项

```bash
# 数据库 (优先 DB_*, PG_* 仅向后兼容)
DB_HOST=your-pg-host
DB_PORT=5432
DB_USER=telehubx
DB_PASSWORD=<secret>
DB_NAME=telehubx

# Redis
REDIS_HOST=your-redis-host
REDIS_PORT=6379

# 安全 (生产必须显式设, 否则 server 启动会 throw)
JWT_SECRET=<random 64+ chars>
SESSION_ENCRYPTION_KEY=<random 64+ chars>
AGENT_TOKEN=<random 64+ chars>      # agent ↔ server 通信凭证

# TypeORM (Codex round-11 #1)
NODE_ENV=production
TYPEORM_SYNC=false                  # 生产必须 false, schema 演进走 migration

# CORS (Codex round-11 #6)
CORS_ORIGINS=https://app.telehubx.com,https://admin.telehubx.com

# Telegram
TG_API_ID=<your apps id>
TG_API_HASH=<your apps hash>

# 可选
APP_PORT=9800
SERVER_URL=http://localhost:9800     # agent → server URL
AI_DAILY_LIMIT_PER_CHAT=50           # 单客户每日 AI 回复上限 (兜底, tenant 可覆盖)
```

---

## 2. 部署步骤

```bash
# 1) 安装依赖
pnpm install

# 2) 启动 PostgreSQL + Redis (Docker)
docker compose up -d

# 3) 构建
cd apps/server && pnpm build && cd ../..
cd apps/agent  && pnpm build && cd ../..
cd apps/dashboard && pnpm build && cd ../..

# 4) 跑 migration (生产必做, dev 可省 — TYPEORM_SYNC=true 自动)
cd apps/server
pnpm migration:run
cd ../..

# 5) 启动 (推荐 pm2)
pm2 start ecosystem.config.cjs

# 6) 健康检查
curl http://localhost:9800/api/v1/health
```

---

## 3. 启动顺序

1. **PostgreSQL** 先就绪 (Docker compose 自动检查)
2. **Redis** 就绪
3. **server** (NestJS) — 必须先于 agent (agent 启动会拉账号需要 server 在线)
4. **dashboard** (Vite preview) — 任意时间可启动, 只是 UI
5. **agent** (Telegram client 进程) — 最后

```bash
pm2 start telehubx-server
sleep 5
pm2 start telehubx-dashboard
pm2 start telehubx-agent
```

---

## 4. 上线前必跑的验证 (dry-run, 不发真实消息)

| 验证 | 命令 / 操作 |
|---|---|
| Server 启动 0 error | `pm2 logs telehubx-server --lines 50` |
| TYPEORM_SYNC 为 false | 确认无 `[TypeORM] WARNING: TYPEORM_SYNC=true in production` |
| Migration 已执行 | `cd apps/server && pnpm migration:show` 应全绿 |
| AGENT_TOKEN/JWT_SECRET 已设 | `pm2 env telehubx-server` 检查 |
| Smart CS dry-run | dashboard → 设置 → 系统维护 → "AI Key 测试" 按钮跑通 |
| Agent 自检 | dashboard → 系统维护 → "账号自检 (M6)" 选号点测, 6 项 RPC 全 ✓ |
| 单元测试 | `cd apps/server && pnpm test` 28+ tests pass |

**禁止**: 生产环境跑真实 campaign send 验证 (会真发消息)

---

## 5. 常见上线问题排查

### server 启动失败 "JWT_SECRET must be set in production"

→ 设 `JWT_SECRET` 长随机字符串 (建议 `openssl rand -hex 32`)

### agent 一直拉不到任务

→ 检查 `AGENT_TOKEN` server 端和 agent 端是否一致
→ 检查 server 日志看是否有 `agent token cannot access` 拒绝

### dashboard 跨域被拒

→ 设 `CORS_ORIGINS=https://你的前端域名` (Codex round-11 #6)

### migration 报"column already exists"

→ 该 column 已被 dev synchronize 自动加. migration 用 `IF NOT EXISTS` 应该不会报, 报了说明手动改过 schema, 删本地 migration record 重跑即可

---

## 6. 回滚

```bash
# 撤销最近一次 migration
cd apps/server && pnpm migration:revert

# 整个回滚一个版本
git checkout <previous-commit>
pnpm install
pnpm build
pm2 restart all
```

---

## 7. 监控建议 (生产)

| 指标 | 阈值 |
|---|---|
| server 进程内存 | > 500MB 重启 |
| agent watchdog timeout 数/小时 | > 5 报警 |
| Bot Gateway sendText 失败率 | > 5% 报警 |
| campaign sentCountedAt vs messageSentAt 差异 | > 1% 报警 (说明 sentCount 漏算) |
| Redis ai:conv:* key 数 | > 100k 清理 |
