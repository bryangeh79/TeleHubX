# TeleHubX — 系统架构设计蓝图

> **GitHub:** https://github.com/bryangeh79/TeleHubX
> **本地路径:** `C:\AI_WORKSPACE\Telegram Auto Bot`
> **版本:** v1.0 (草案)
> 基于 WAhubX 架构经验 + 2025-2026 年 Telegram 养号行业最佳实践调研
>
> **架构定性：** SaaS 多租户系统
> **授权模式：** License Key 激活（复用 WAhubX Ed25519 签名+验证体系）
> **部署模式：** 轻量服务端(VPS) + 重量客户端(本地/租户服务器)
> **多语言：** 后期实现（架构预留 i18n 接入点，现阶段仅中文/英文占位符）

---

## 一、设计原则

1. **绝对隔离** — 每个账号独立容器 + 独立代理 IP + 独立 Session
2. **绝对真人化** — 所有行为模拟真实人类（频率、时序、内容、随机性）
3. **零关联** — 任何两个账号之间不可存在可被关联的痕迹（IP、时序、内容模板、设备指纹）
4. **渐进信任** — 新号必须经过 Warmup 周期，逐步建立 Telegram 信任分
5. **可观测** — 所有账号状态、风险事件、健康分实时可见
6. **租户隔离** — 每个租户数据完全隔离（schema-per-tenant）

---

## 二、SaaS 多租户架构

### 2.1 租户模型

```
┌──────────────────────────────────────────────────────────────┐
│                    SaaS Platform (单实例)                      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Tenant A     │  │ Tenant B     │  │ Tenant C     │ ...   │
│  │ License: X1  │  │ License: Y9  │  │ License: Z3  │       │
│  │ Plan: Basic  │  │ Plan: Pro    │  │ Plan: Enter  │       │
│  │ 10 accounts  │  │ 30 accounts  │  │ 50 accounts  │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                │                │                │
│         ▼                ▼                ▼                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Data Isolation 策略                      │   │
│  │  • schema-per-tenant (每个租户独立 PostgreSQL schema) │   │
│  │  • License 绑定 Plan (套餐限额)                       │   │
│  │  • 容器网络完全隔离                                     │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 License Key 激活流程

复用 WAhubX 现有的 Ed25519 签名体系，不需重新发明轮子：

```
                        ┌──────────────────┐
                        │  License Server   │
                        │  (Cloudflare      │
                        │   Workers)        │
                        └────────┬─────────┘
                                 │ 验证签名
┌──────┐    输入 License Key     ┌──▼───────┐     创建 Tenant      ┌──────────┐
│ User │ ────────────────────── ▶ │  Backend  │ ────────────────── ▶ │ PostgreSQL│
│      │                        │ 验证签名   │                      │ (新Schema)│
└──────┘                        │ 校验限额   │                      └──────────┘
                                │ 激活账户   │
                                └──────────┘
```

**复用的 WAhubX 模块清单：**
| 文件 | 功能 |
|------|------|
| `modules/signing/ed25519-signer.service.ts` | License 签名（服务端） |
| `modules/signing/ed25519-verifier.service.ts` | License 验证（客户端） |
| `modules/licenses/license.entity.ts` | License 数据实体 |
| `modules/licenses/license.service.ts` | License 生命周期管理 |
| `modules/licenses/license-server-client.service.ts` | 云端验证客户端 |
| `modules/tenants/tenant.entity.ts` | 租户实体（可适配） |

### 2.3 混合部署架构

**核心原则：** 服务端极轻，只做 Web + DB；容器农场跑在租户本地/服务器。

```
┌──────────────────────────────────────────┐     ┌──────────────────────────────────┐
│         轻量 VPS（服务端）                │     │    本地/租户服务器（客户端）     │
│                                          │     │                                  │
│  • NestJS API Server                     │     │  • Docker Container Farm         │
│    - Auth / RBAC / License               │     │    (所有 TG 账号容器)            │
│    - Account Management (编排层)          │     │    • Container #1 (GramJS+S5)   │
│    - Warmup Engine (调度层)              │     │    • Container #2 (GramJS+S5)   │
│    - AI Services (复用 WAhubX)           │     │    • Container #3 (GramJS+S5)   │
│    - Takeover Gateway                    │     │    • ...                        │
│    - Campaigns (复用 WAhubX)            │     │                                  │
│  • PostgreSQL (租户 schemas)             │     │  • Runtime Agent (Node.js)      │
│  • Redis + BullMQ (轻量队列)             │     │    - 连接服务端 WS              │
│  • Web Dashboard (React SPA, 静态服务)   │     │    - 执行容器管理指令           │
│                                          │     │    - 转发容器事件上报            │
│  资源需求: 2C / 4GB RAM / 50GB SSD      │     │    - Session 本地备份           │
│  (通常 < 50 个租户时够用)                │     │                                  │
│                                          │     │  • SOCKS5 代理出口              │
│  依赖: Docker Engine（只跑 2-3 个镜像）   │     │    (每个容器独立 IP)            │
│                                          │     │                                  │
│                                          │     │  资源需求: 视账号数而定         │
│                                          │     │  50 账号 ≈ 16C / 32GB RAM       │
└─────────────────────┬────────────────────┘     └──────────────┬───────────────────┘
                      │                                         │
                      └────────────── WS + HTTPS ───────────────┘
                          (加密通道，自动重连)
```

**为什么这样分拆：**
- TG 容器不吃 CPU（无需浏览器），但 50 个账号的 Node 进程 + 并发 WS 连接仍有负载
- 本地执行 = 零网络延迟，代理出口更可控
- 服务端崩了不影响已有连接，容器直接继续运转
- 一个 VPS 可以服务无限个租户（只做编排，不跑容器）
- 租户数据存在服务端 PostgreSQL，管理方便

### 2.4 多租户数据隔离

**最终方案：schema-per-tenant**
- 每个租户激活时创建独立 schema：`tenant_<uuid>`
- TypeORM 通过 `EntityManager` 动态切换 schema
- 完全隔离，一个租户的 SQL 不可能污染另一个租户

**开发阶段备选：** row-level `tenant_id` 过滤（简化开发，上线前迁移）

---

## 三、顶层架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Web Dashboard (React SPA)                      │
│  Dashboard | 账号管理 | 养号计划 | AI配置 | 广告投放 | 代理管理     │
│  接管界面 | 系统设置 |   [多语言预留]                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS / WS (JWT Auth)
┌──────────────────────────▼──────────────────────────────────────────┐
│                      API Gateway (NestJS)                           │
│  Tenant Resolution | Rate Limit | Logging | Versioning | i18n Guard │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                      Core Backend (服务端)                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Tenant       │  │ License      │  │ Auth/RBAC    │              │
│  │ Manager      │  │ Validator    │  │ (JWT)        │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐                   │
│  │  Account Manager    │  │  Warmup Engine      │                   │
│  │  (账号编排层)       │  │  (养号调度器)       │                   │
│  └─────────┬───────────┘  └──────────┬──────────┘                  │
│            │                        │                              │
│  ┌─────────▼────────────────────────▼──────────┐                   │
│  │       Runtime Bridge (WS Gateway)            │                   │
│  │  服务端 ↔ 客户端 Runtime Agent 双向通信       │                   │
│  └─────────┬───────────────────────────────────┘                   │
│            │                                                        │
│  ┌─────────▼───────────────────────────────────┐                   │
│  │       Remote Container Proxy                 │                   │
│  │  通过 Runtime Agent 管理远程容器             │                   │
│  └──────────────────────────────────────────────┘                   │
│                                                                     │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐         │
│  │ AI Engine │ │Takeover   │ │Campaigns  │ │ Health     │          │
│  │(智能回复) │ │(人工接管)  │ │(广告投放) │ │ Monitor    │          │
│  └───────────┘ └───────────┘ └───────────┘ └────────────┘          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │               Shared Services                              │       │
│  │  Asset Pool | KB | Proxy Pool | Backup | Notification     │       │
│  └──────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                 Infrastructure Layer (服务端)                         │
│  ┌──────────────┐  ┌──────────────┐                               │
│  │ PostgreSQL   │  │ Redis        │                               │
│  │ (租户Schema)  │  │ (BullMQ队列)  │                               │
│  └──────────────┘  └──────────────┘                               │
└──────────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│               Runtime Agent (客户端/租户服务器)                      │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Docker Container Farm                       │  │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐    ┌───────────┐ │  │
│  │  │Container #1│ │Container #2│ │Container #3│...│Container │ │  │
│  │  │ GramJS    │ │ GramJS    │ │ GramJS    │    │ #50      │ │  │
│  │  │ Session 1 │ │ Session 2 │ │ Session 3 │    │ GramJS   │ │  │
│  │  │ S5 IP #1  │ │ S5 IP #2  │ │ S5 IP #3  │    │ Session50│ │  │
│  │  └───────────┘ └───────────┘ └───────────┘    │ S5 IP#50 │ │  │
│  │                                               └───────────┘ │  │
│  │  网络：Traefik/Nginx 代理分发 + DNS 防泄漏                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 四、前后端并行设计策略

### 4.1 并行开发路线

```
Weeks:    1      2      3      4      5      6      7      8
         ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
后端:     │ P1   │  P2  │  P2  │  P3  │  P4  │  P4  │  P5  │  P6  │
         │ 初始化│ 单号 │ 核心 │ 容器 │ 养号 │ 高级 │ 稳定 │ 收尾 │
         │      │ Bind │ 流程 │ 农场 │ 引擎 │ 功能 │ 加固 │      │
         ├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
前端:     │      │  P2  │  P2  │  P3  │  P4  │  P5  │  P6  │  P6  │
         │      │ 框架 │ 账号 │ 仪表 │ 配置 │ 接管 │ 系统 │ 集成 │
         │      │ 搭建 │ 管理 │ 盘   │ 页面 │ 页面 │ 页面 │ 测试 │
         └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```

### 4.2 前端技术方案

| 层面 | 选型 | 说明 |
|------|------|------|
| **框架** | React 18 + TypeScript | 与 WAhubX 一致 |
| **UI 库** | Ant Design 5.x | 与 WAhubX 一致，开箱即用 |
| **构建** | Vite | 比 CRA 快，预留 i18n 插件位 |
| **路由** | React Router v6 | 简单直接 |
| **状态管理** | React Query + Zustand | 轻量，不需要 Redux |
| **实时通信** | Socket.IO Client | 与 WAhubX 一致（Takeover/状态） |
| **图表** | @ant-design/charts | 健康评分可视化 |
| **多语言** | react-i18next | 现阶段只挂载，不做翻译 |

### 4.3 前端页面规划

| 页面 | 路由 | 说明 | 开发优先级 |
|------|------|------|-----------|
| **登录/激活** | `/login`, `/activate` | License Key 输入、登录 | P2 |
| **Dashboard 总览** | `/dashboard` | 账号健康分概览、操作统计、警报 | P3 |
| **账号管理** | `/accounts` | 列表/状态/绑定/详情 | P2 |
| **账号绑定** | `/accounts/bind` | 输入 phone number、输入 OTP | P2 |
| **养号计划** | `/warmup` | 配置、进度、手动干预 | P4 |
| **AI 配置** | `/ai` | Provider 管理、回复策略、知识库 | P4 |
| **人工接管** | `/takeover` | 实时聊天界面（复用 WAhubX 组件） | P5 |
| **广告投放** | `/campaigns` | Campaign 创建、素材、发送记录 | P5 |
| **代理管理** | `/proxies` | 代理池/账号绑定/健康检测 | P3 |
| **系统设置** | `/settings` | 套餐/用户/备份/多语言切换(预留) | P6 |

### 4.4 多语言 i18n 预留

现阶段只做架构预留，不做翻译：

```typescript
// src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// 现阶段只加载中文，英文后续批量补
import zh from './locales/zh.json';
import en from './locales/en.json';

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: 'zh',              // 默认中文
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  // 后端允许时启用自动加载
  // backend: { loadPath: '/locales/{{lng}}/{{ns}}.json' }
});
```

后端同样预留 i18n 响应头检测：

```typescript
// NestJS 全局 Interceptor
@Injectable()
export class I18nInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const lang = request.headers['accept-language']?.split(',')[0] || 'zh';
    request.lang = lang;
    return next.handle();
  }
}
```

---

## 五、技术选型详述

### 5.1 客户端库：GramJS（TypeScript）

**选择的理由：**
- Telegram client API 有四个主流选项，适配你的技术栈的只有 GramJS
- 底层基于 Telethon（23k stars 的 Python 库），稳定性已在大规模场景验证
- 原生支持 TypeScript，和 NestJS 完美集成
- 支持 StringSession 序列化（可存 DB）和文件 Session
- 14k+ GitHub stars，社区活跃

**不选其他库的原因：**
- ❌ TDLib — 官方 C++ 库，Node.js binding 配置复杂，编译环境维护成本高
- ❌ Telethon — Python，需额外维护一套 Python 服务
- ❌ Pyrogram — Python，同 Telethon 问题
- ❌ Bot API — 只能用 bot 账号，不能用普通用户号（你需要的功能必须用 Client API）

### 5.2 设备指纹策略 — Telegram 看到的是什么

这是最关键的细节。通过 GramJS 的 `TelegramClientParams` 控制：

```typescript
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

const client = new TelegramClient(
  new StringSession(''),     // session
  apiId,                      // 从 my.telegram.org 获取
  apiHash,                    // 从 my.telegram.org 获取
  {
    // ★ 设备模型：模拟特定手机
    deviceModel: 'Samsung SM-S928B',   // Galaxy S24 Ultra (马来西亚常见)
    systemVersion: '14',               // Android 14
    appVersion: '10.14.2',            // Telegram Android 最新版
    langCode: 'en',
    systemLangCode: 'en-MY',
    
    // ★ 连接层
    connectionRetries: 5,
    useWSS: false,                     // 用 TCP 直连（更稳定）
    
    // ★ 代理
    proxy: {
      ip: '...',                       // 每个账号独享 SOCKS5 代理
      port: 1080,
      socksType: 5,
      username: '...',
      password: '...',
    }
  }
);
```

**Telegram 服务端视角看到的信息：**

| 字段 | 值 | 说明 |
|------|----|------|
| Device model | Samsung SM-S928B | 模拟真实 Android 设备 |
| API ID | xxx | 来自 my.telegram.org 的开发者 API ID |
| Platform | Android | 手机平台 |
| App version | 10.14.2 | Telegram app 版本 |
| System version | 14 (API 34) | Android 系统版本 |
| Network IP | 住宅代理 IP | 家用宽带/移动网络 |
| DC ID | 根据 IP 就近分配 | Telegram 数据中心 |

**结论：** TG 看到的是一台 **Samsung 手机在马来西亚住宅网络下通过 Telegram App 登录**。不是浏览器，不是桌面客户端，不是自动化工具。

### 5.3 DC 连接与 IP 持久性

Telegram 架构中，每个账号连接到一个 Data Center（DC），DC 通过 IP 识别客户端。**业界关键规则：**

1. **一个账号一个固定 IP** — 不要轮换。TG 将 Session + IP 绑定在 DC 上
2. **IP 变化会触发 re-authorization** — 频繁变化会被标记
3. **账号注册时的 IP 最好长期持有** — 特定 DC 有迁移成本

### 5.4 代理策略

| 类型 | TG 兼容性 | 推荐度 | 说明 |
|------|----------|--------|------|
| SOCKS5 住宅代理 | ⭐⭐⭐⭐⭐ | ✅ **推荐** | TG 原生支持 SOCKS5，住宅 IP 最接近真人 |
| SOCKS5 移动代理 | ⭐⭐⭐⭐⭐ | ✅ **最佳** | 移动 IP 段最安全 |
| MTProto Proxy | ⭐⭐⭐⭐ | ⚠️ 可选 | TG 原生 MTProto 协议，但不利于多账号分组隔离 |
| Datacenter Proxy | ⭐⭐ | ❌ 不推荐 | 容易触发限制 |

---

## 六、容器架构（每个账号的隔离单元）

### 6.1 容器内部结构

```
┌─────────────────────────────────────────┐
│     Docker Container (node:20-alpine)    │
│              ~150MB                      │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │  runtime-agent (Node.js 进程)       ││
│  │                                     ││
│  │  ┌─────────────┐ ┌──────────────┐  ││
│  │  │ GramJS      │ │ Behavior     │  ││
│  │  │ Client      │ │ Simulator    │  ││
│  │  └──────┬──────┘ └──────┬───────┘  ││
│  │         │              │           ││
│  │  ┌──────▼──────────────▼───────┐  ││
│  │  │  Action Executor            │  ││
│  │  │  sendMessage / joinGroup /  │  ││
│  │  │  addContact / followChannel │  ││
│  │  │  keepOnline / sendMedia     │  ││
│  │  │  sendPhoto / sendVideo      │  ││
│  │  └─────────────────────────────┘  ││
│  │                                     ││
│  │  ┌─────────────────────────────┐  ││
│  │  │  Event Listener             │  ││
│  │  │  (incoming messages,        │  ││
│  │  │   updates, errors)          │  ││
│  │  └──────────┬──────────────────┘  ││
│  └─────────────┼──────────────────────┘│
│                │ WS                    │
│  ┌─────────────▼──────────────────────┐│
│  │  WS Client → Runtime Agent →       ││
│  │  Backend RuntimeBridge             ││
│  └────────────────────────────────────┘│
│                                         │
│  Volumes:                               │
│  - /data/session        ← Session 文件  │
│  - /data/assets         ← 素材缓存      │
│  - /data/logs           ← 日志          │
│                                         │
│  网络:                                   │
│  - 绑定 SOCKS5 代理出口                  │
│  - DNS over HTTPS (防泄漏)              │
└─────────────────────────────────────────┘
```

### 6.2 与 WAhubX 容器对比

| 维度 | WAhubX (WA) | TeleHubX |
|------|-------------|---------|
| 基础镜像 | `node:20-bookworm-slim` + Chromium | `node:20-alpine` |
| 镜像大小 | ~500MB+ | ~150MB |
| 进程 | Chromium (Puppeteer) + Node | 仅 Node (GramJS) |
| 启动速度 | 慢（Chromium 启动 5-10s） | 快（GramJS 连接 1-3s） |
| 资源占用 | CPU/内存高 | CPU/内存低 |

### 6.3 防 DNS 泄漏

每个容器启动时执行 DNS 泄漏检查（参考 WAhubX 的 `integrity-checks/dns-leak.ts`）：
- 容器 DNS 设置为 `127.0.0.1`（通过 dnsmasq 转发）
- 代理出口强制所有流量走 SOCKS5
- 检测 ipv4.ident.me、ifconfig.me 等是否泄漏真实 IP

---

## 七、模块分解（与 WAhubX 对比）

### 7.1 可以直接复用业务逻辑的模块

| 模块 | 文件路径（WAhubX） | 复用策略 |
|------|-------------------|---------|
| **AI Provider** | `modules/ai/*` | 完全复用（多 Provider、加密、API key 管理） |
| **Intelligent Reply** | `modules/intelligent-reply/*` | 完全复用（FAQ 匹配 + AI 回复） |
| **Campaigns** | `modules/campaigns/*` | 70% 复用（营销流程 + 素材调度，改发送通道） |
| **Takeover** | `modules/takeover/*` | 80% 复用（WS gateway + 队列 + 人工接管逻辑） |
| **Assets** | `modules/assets/*` | 完全复用（素材池、视频/文案管理） |
| **Auth** | `modules/auth/*` | 完全复用（JWT + RBAC） |
| **Backup** | `modules/backup/*` | 60% 复用（session 备份机制不同） |
| **Signing** | `modules/signing/*` | 完全复用（Ed25519 签名校验） |
| **Account Health** | `modules/account-health/*` | 完全复用（健康评分、风险事件、警报） |
| **Execution Groups** | `modules/execution-groups/*` | 完全复用（任务执行分组） |
| **Channel Items** | `modules/channel-items/*` | 完全复用（频道/群素材管理） |
| **Licenses** | `modules/licenses/*` | 完全复用（License 生命周期） |
| **Tenants** | `modules/tenants/*` | 适配为 TeleHubX 的 tenant 模型 |

### 7.2 需要重写的模块

| 模块 | 原因 |
|------|------|
| **Messaging** | WA Web DOM 操作 → TG MTProto API 调用 |
| **Slots (Account Slot)** | 账号绑定从 Chromium session 改为 GramJS session |
| **Slot Runtime** | Chromium Puppeteer 改为 GramJS 客户端 |
| **Runtime Process** | Chromium 进程管理改为 GramJS 进程管理 |
| **Warmup** | WA 的 warmup 策略（浏览状态、发帖）改为 TG 策略（加群、互动、频道） |

---

## 八、关键流程设计

### 8.1 账号绑定流程（Bind）

```
User 提交 phone number
  │
  ▼
Backend 验证租户限额（未超账号上限）
  │
  ├── 已达上限 → 拒绝
  └── 未超限 → 继续
  │
  ▼
Runtime Agent 通过 Docker SDK 创建容器
  ├── 分配 SOCKS5 代理
  ├── 挂载 Volume
  └── 启动容器
  │
  ▼
容器内 GramJS Client 启动:
  ├── 加载 Session（如存在）
  ├── 无 Session → 调用 client.sendCode(phone)
  ├── OTP 发送到 phone
  └── 等待用户输入 OTP
  │
  ▼
User 在 Dashboard 输入 OTP
  │
  ▼
容器 GramJS 调用 client.signIn(phone, code)
  ├── 成功 → StringSession → 保存容器 Volume + DB
  ├── 2FA 开启 → 用户输入密码
  └── 失败 → 上报错误
  │
  ▼
绑定成功
  ├── 设置 Profile（头像/Bio/用户名）
  ├── 标记温状态
  └── 开始 Warmup Engine 调度
```

### 8.2 Runtime Agent ↔ Backend 通信

```
┌──────────┐         WS (wss://)          ┌──────────────┐
│ Backend   │ ◄══════════════════════════► │ Runtime Agent│
│ (VPS)     │                              │ (本地服务器) │
└──────────┘                              └──────┬───────┘
                                                  │ Docker SDK
                                          ┌───────▼───────┐
                                          │ Container Farm │
                                          └───────────────┘
```

**Agent 职责：**
- 启动时注册到 Backend（认证 token）
- 接收 Backend 指令：`create_container`, `stop_container`, `restore_session`
- 转发容器事件到 Backend：`account_status`, `incoming_message`, `error`
- 执行健康检查，上报本地资源（CPU/RAM/Disk）

**断线处理：**
- Agent 自动重连
- 断线期间容器继续运行
- 重连后重新上报所有容器状态

### 8.3 养号引擎（Warmup Engine）

以 7 天为周期的渐进式养号计划：

| 阶段 | 天 | 每日动作 | 频率控制 |
|------|----|---------|---------|
| P0: 初始化 | Day 0 | 设置 Profile 头像、Bio、用户名 | 一次性 |
| P1: 沉默观察 | Day 1-2 | 加入 1-2 个无害群组、0 发言 | 加群间隔 > 6h |
| P2: 轻微活动 | Day 3-4 | 浏览消息、点击回应、关注 2-3 个频道 | 3-5 动作/天 |
| P3: 社交建立 | Day 5-6 | 发 1-2 条群消息、加 1-2 个好友 | 消息间隔 Gaussian 分布 |
| P4: 常规运营 | Day 7+ | 按配置频率正常操作 | 逐步增加到目标频率 |

每个动作间隔使用 Gaussian 随机分布（参考 WAhubX 的 `HumanBehaviorSimulator.randomDelay()`），不是固定计时器。

### 8.4 智能回复流程

```
Incoming Message 到达 TG Client
  │
  ▼
容器 Event Listener 捕获
  │
  ▼
通过 WS → Runtime Agent → Backend RuntimeBridge
  │
  ▼
Intelligent Reply Service:
  ├── 检查该账号是否启用 AI 回复
  ├── 否 → 忽略
  └── 是 →
       ├── 检索 Knowledge Base (Vector DB)
       ├── 构造 Prompt（含对话上下文）
       ├── 调用 AI Provider
       ├── 获取回复文本
       │
       ▼
  HumanBehavior 延迟模拟（3-15s Gaussian）
       │
       ▼
  回写指令 → WS → Runtime Agent → 容器
       │
       ▼
  容器 GramJS 发送回复
```

### 8.5 人工接管（Takeover）

与 WAhubX 相同架构：

```
Operator 点击 "接管" →
  Backend 发送接管指令到容器 →
  容器暂停所有自动行为 →
  WS 建立实时双向通道 →
  Operator 在 Dashboard 实时对话 →
  Operator 释放接管 →
  容器恢复自动行为
```

### 8.6 健康监控体系

```
每个容器定时上报:
  ├── Client 状态 (connected / disconnected / flood-wait)
  ├── 今日操作计数 (messages sent / joins / adds)
  ├── FloodWait 频率 & 持续时间
  ├── 消息送达率
  ├── RPC 错误率 (FloodWait / Timeout / Migrate)
  └── 响应延迟中位数
  │
  ▼
Health Scorer 聚合评分 (0-100):
  ├── Score > 80: 健康（绿色）
  ├── Score 60-80: 告警（黄色，降低频率）
  ├── Score 30-60: 危险（橙色，暂停部分操作）
  └── Score < 30: 风险（红色，暂停该账号）
  │
  ▼
Alert Dispatcher:
  ├── 邮件通知
  ├── Dashboard 横幅
  └── 自动降级策略（降低操作频率/暂停）
```

---

## 九、数据模型核心实体

```typescript
// === 租户 ===
Tenant {
  id: UUID
  name: string
  schemaName: string          // PostgreSQL schema
  plan: 'basic' | 'pro' | 'enterprise'
  maxAccounts: number
  licenseKey: string
  licenseExpiresAt: DateTime
  status: 'active' | 'suspended' | 'expired'
  createdAt: DateTime
}

// === License（复用 WAhubX）===
License {
  id: UUID
  key: string                 // 签名后的 Key
  tenantId: UUID → Tenant
  plan: string
  expiresAt: DateTime
  signature: string           // Ed25519 签名
  machineId: string | null    // 绑定的机器（可选）
}

// === 账号 ===
Account {
  id: UUID
  tenantId: UUID → Tenant
  phoneNumber: string
  apiId: number
  apiHash: string (encrypted)
  sessionData: string (encrypted StringSession)
  deviceModel: string
  proxyId: UUID → Proxy
  status: 'idle' | 'binding' | 'connected' | 'error' | 'suspended' | 'banned'
  healthScore: number
  warmupPhase: number
  warmupStartedAt: DateTime | null
  totalMessagesSent: number
  lastActivityAt: DateTime
  isOnline: boolean
  connectedAt: DateTime | null
  createdAt: DateTime
}

// === 容器实例（存储在 Agent 端）===
ContainerInstance {
  id: UUID
  tenantId: UUID → Tenant
  accountId: UUID → Account
  agentId: UUID → RuntimeAgent
  dockerContainerId: string
  status: 'running' | 'stopped' | 'error'
  startedAt: DateTime
  lastHeartbeatAt: DateTime
  resourceUsage: { cpu: number, mem: number }
}

// === Runtime Agent ===
RuntimeAgent {
  id: UUID
  tenantId: UUID → Tenant
  hostname: string
  ipAddress: string
  authToken: string
  status: 'online' | 'offline'
  lastHeartbeatAt: DateTime
  totalContainers: number
  resources: { cpu: number, ram: number, disk: number }
  version: string
  registeredAt: DateTime
}

// === 代理 ===
Proxy {
  id: UUID
  tenantId: UUID → Tenant
  type: 'socks5' | 'mtproto'
  host: string
  port: number
  username: string (encrypted)
  password: string (encrypted)
  ipAddress: string
  isp: string
  country: string
  status: 'active' | 'dead' |
