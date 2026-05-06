# TeleHubX Runtime Binaries

> Phase 3 准备目录。**二进制不入仓**（体积巨大），由 `installer/build-dist.cjs` 在打包时从 `vendor/` 拷贝。
> 构建机器上需要先把以下三套二进制放到 `vendor/`，详见下文。

## 目标布局（dist 中的样子）

```
dist/
├── runtime/
│   ├── node/
│   │   └── node.exe                       ← v20 LTS Windows x64
│   ├── postgres/
│   │   ├── bin/
│   │   │   ├── postgres.exe
│   │   │   ├── pg_ctl.exe
│   │   │   ├── initdb.exe
│   │   │   ├── psql.exe
│   │   │   └── ...
│   │   ├── lib/
│   │   │   └── vector.dll                 ← pgvector 0.7+
│   │   ├── share/
│   │   └── ...
│   └── redis/
│       ├── redis-server.exe                  ← tporadowski/redis 5.0.14.1 (BSD-3-Clause)
│       ├── redis-cli.exe
│       ├── redis.conf                        ← bundled (loopback + 6386 + no persist + 64MB LRU)
│       └── LICENSE-tporadowski-redis.txt
├── app/
├── tools/
└── .env
```

## 1. Node v20 LTS

下载: https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip
（或 v20 系列任一最新 patch）

解压后只保留 `node.exe` 即可（约 60 MB）。

```
vendor/node-v20-win-x64/
└── node.exe                              ← 需要这一个文件
```

## 2. Postgres Portable v16 + pgvector

### 2.1 EnterpriseDB 版（推荐，license 简单）
下载: https://www.enterprisedb.com/download-postgresql-binaries
选 v16.x Windows x64 binaries（不是 installer 版）→ 解压 zip。

```
vendor/postgres-16-portable/
├── bin/
├── doc/
├── include/
├── lib/
├── share/
└── ...
```

只保留 `bin/`、`lib/`、`share/`、`StackBuilder` 删除（约 150 MB → 100 MB）。

### 2.2 加 pgvector

下载: https://github.com/pgvector/pgvector/releases (Windows pre-built)
或自行编译。需要将以下文件放到 portable postgres 内：

- `vector.dll` → `vendor/postgres-16-portable/lib/`
- `vector.control` → `vendor/postgres-16-portable/share/extension/`
- `vector--*.sql` → `vendor/postgres-16-portable/share/extension/`

### 2.3 首次启动初始化（supervisor 自动调）

`installer/runtime/postgres/init-pgdata.cjs` 在 supervisor prod 模式下，
检测到 `<dataDir>/pgdata/PG_VERSION` 不存在时自动跑：

1. `initdb -D <dataDir>/pgdata --locale=C --encoding=UTF8 --auth-local=trust --auth-host=md5`
2. 启 postgres 监听 5436
3. `createuser telehubx --no-superuser --no-createdb --no-createrole`
4. `createdb telehubx --owner=telehubx`
5. `psql -d telehubx -c 'CREATE EXTENSION IF NOT EXISTS vector;'`
6. 写 `<dataDir>/pgdata/postgresql.conf`：`listen_addresses='127.0.0.1'`, `port=5436`

## 3. Redis for Windows (tporadowski/redis)

替换原 Memurai 方案 — 见 Issue #12 audit + decision。

**为什么换**：
- TeleHubX 实际使用 Redis 仅 3 处（AI 上下文、速率限制、Bot 去重），全是基本 KV
- 零 BullMQ / 队列 / pub-sub / Lua 使用
- Memurai Enterprise 商业授权对客户分发产生成本与采购摩擦
- tporadowski/redis 是 BSD-3-Clause 免费可商用，已在 FAhubX 实战

**版本**: v5.0.14.1 (Microsoft archived 2016 后的社区延续)
**License**: 3-Clause BSD ([`vendor/redis-windows/...`](https://github.com/tporadowski/redis))
**自动下载**: `installer/scripts/fetch-vendor.ps1` 一键获取

```
vendor/redis-windows/
├── redis-server.exe         (~1.4 MB)
├── redis-cli.exe
├── redis-check-rdb.exe
├── redis-check-aof.exe
├── redis-benchmark.exe (optional)
├── 00-RELEASENOTES          (Redis upstream license)
└── README.txt
```

`installer/runtime/redis/redis.conf` 由 build-dist.cjs 一并复制到
`dist/runtime/redis/redis.conf`：loopback only / 6386 / **持久化关闭** /
maxmemory 64mb / allkeys-lru。

## 4. 总体积

| 组件 | 大小 |
|------|------|
| Node v20 LTS (node.exe only) | ~60 MB |
| Postgres Portable + pgvector | ~120 MB |
| Redis-for-Windows | ~6 MB |
| App build (server+agent+dashboard) | ~30 MB |
| node_modules (server+agent) | ~40 MB |
| **合计** | **~256 MB** |

LZMA2 ultra64 压缩后实测安装包约 **98 MB**。

## 5. supervisor 自动检测逻辑

```typescript
// installer/tools/src/supervisor.ts
const portableNode = path.join(env.installPath, 'runtime', 'node', 'node.exe');
const node = existsSync(portableNode) ? portableNode : process.execPath;

// postgres / redis 在 services 数组里通过 enabledIn=['prod'] 控制
// 如果 runtime/postgres/bin/postgres.exe 不存在 → spawn 时报 exe missing → critical 失败
// 如果 runtime/redis/redis-server.exe 不存在 → 同上
```

也就是说：
- `dev` 模式：跳过 postgres/redis（假设 Docker 已起），不要求 runtime/ 有这两个目录
- `prod` 模式：runtime/postgres + runtime/redis 必须齐全，否则 supervisor abort

## 6. Phase 4 衔接

Phase 4 Inno Setup 脚本的 `[Files]` section 包含：

```pascal
Source: "dist\runtime\node\*";     DestDir: "{app}\runtime\node";     Flags: recursesubdirs ignoreversion
Source: "dist\runtime\postgres\*"; DestDir: "{app}\runtime\postgres"; Flags: recursesubdirs ignoreversion
Source: "dist\runtime\redis\*";    DestDir: "{app}\runtime\redis";    Flags: recursesubdirs ignoreversion
```

dist 目录组装好后用 ISCC.exe 编译生成 `TeleHubX-Setup-<ver>.exe`。
