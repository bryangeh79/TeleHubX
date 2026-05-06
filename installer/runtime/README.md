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
│   └── memurai/
│       ├── memurai.exe
│       └── ...
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

## 3. Memurai

Memurai 是 Redis API 兼容的 Windows 实现。

下载: https://www.memurai.com/get-memurai
选 **Memurai Developer**（非生产环境免费） 或 **Memurai for Redis**（商业版）。

> ⚠️ **License 注意**：Memurai Developer 仅供开发/测试用。商业部署需要购买 Memurai Enterprise 或 Memurai for Redis 授权。
> Phase 3 阶段使用 Developer 版即可走通流程；Phase 4/5 上线前需采购正式授权。

```
vendor/memurai/
├── memurai.exe
├── memurai-cli.exe
└── memurai-benchmark.exe (optional)
```

约 12 MB。

## 4. 总体积

| 组件 | 大小 |
|------|------|
| Node v20 LTS (node.exe only) | ~60 MB |
| Postgres Portable + pgvector | ~120 MB |
| Memurai Developer | ~12 MB |
| App build (server+agent+dashboard) | ~30 MB |
| node_modules (server+agent) | ~40 MB |
| **合计** | **~262 MB** |

LZMA2 压缩后预计安装包 ~120 MB。

## 5. supervisor 自动检测逻辑

```typescript
// installer/tools/src/supervisor.ts
const portableNode = path.join(env.installPath, 'runtime', 'node', 'node.exe');
const node = existsSync(portableNode) ? portableNode : process.execPath;

// postgres / memurai 在 services 数组里通过 enabledIn=['prod'] 控制
// 如果 runtime/postgres/bin/postgres.exe 不存在 → spawn 时报 exe missing → critical 失败
// 如果 runtime/memurai/memurai.exe 不存在 → 同上
```

也就是说：
- `dev` 模式：跳过 postgres/memurai（假设 Docker 已起），不要求 runtime/ 有这两个目录
- `prod` 模式：runtime/postgres + runtime/memurai 必须齐全，否则 supervisor abort

## 6. Phase 4 衔接

Phase 4 Inno Setup 脚本的 `[Files]` section 会包含：

```pascal
Source: "runtime\node\*"; DestDir: "{app}\runtime\node"; Flags: recursesubdirs ignoreversion
Source: "runtime\postgres\*"; DestDir: "{app}\runtime\postgres"; Flags: recursesubdirs ignoreversion
Source: "runtime\memurai\*"; DestDir: "{app}\runtime\memurai"; Flags: recursesubdirs ignoreversion
```

dist 目录组装好后用 ISCC.exe 编译生成 `TeleHubX-Setup-<ver>.exe`。
