import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * 集中化用户数据目录解析。
 *
 * 优先级：
 *   1. config.get('TELEHUBX_DATA_DIR')       （安装包注入）
 *   2. process.env.TELEHUBX_DATA_DIR
 *   3. dev fallback: <repo-root>/data
 *
 * 安装包场景下会指向 %APPDATA%\TeleHubX\data。
 *
 * 所有需要持久化用户数据的代码都应通过本模块取路径，避免硬编码 cwd / __dirname。
 *
 * 注意：本 helper 只提供路径计算 + 自动创建目录。Postgres / Memurai 数据目录
 * 由 supervisor 工具直接管理，与此处无关。
 */

export interface DataPaths {
  root: string;            // %APPDATA%\TeleHubX\data 或 dev: ./data
  licenseFile: string;     // cloud-license.bin
  machineFingerprintFile: string;
  agentTokenFile: string;
  sessionsDir: string;     // Telegram session 加密备份
  uploadsDir: string;      // 知识库上传 / 广告素材
  logsDir: string;
  runDir: string;          // pid 文件 / supervisor 状态
}

function resolveDataDir(config?: ConfigService): string {
  const fromConfig = config?.get<string>('TELEHUBX_DATA_DIR');
  const fromEnv = process.env.TELEHUBX_DATA_DIR;
  const explicit = fromConfig ?? fromEnv;

  if (explicit) {
    // 支持 %APPDATA% 风格展开（Windows installer 写 .env 时常用）
    const expanded = explicit.replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? '');
    return path.resolve(expanded);
  }

  // dev fallback: 项目根 ./data
  // dist/main.js 在 apps/server/dist/, 所以从 __dirname 往上 4 级到项目根
  // pm2 cwd 是 apps/server, process.cwd()/data 也对
  if (process.env.NODE_ENV === 'production') {
    // 生产环境无配置 → 落到用户目录避免误写程序目录
    return path.resolve(os.homedir(), 'TeleHubX', 'data');
  }
  return path.resolve(process.cwd(), 'data');
}

let cached: DataPaths | null = null;

export function getDataPaths(config?: ConfigService): DataPaths {
  if (cached) return cached;
  const root = resolveDataDir(config);
  const paths: DataPaths = {
    root,
    licenseFile: path.join(root, 'cloud-license.bin'),
    machineFingerprintFile: path.join(root, 'machine-fingerprint.txt'),
    agentTokenFile: path.join(root, 'agent-token.bin'),
    sessionsDir: path.join(root, 'sessions'),
    uploadsDir: path.join(root, 'uploads'),
    logsDir: path.join(root, 'logs'),
    runDir: path.join(root, 'run'),
  };
  // 自动创建所有目录（幂等）
  for (const dir of [paths.root, paths.sessionsDir, paths.uploadsDir, paths.logsDir, paths.runDir]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore — first init may race; subsequent calls idempotent */
    }
  }
  cached = paths;
  return paths;
}

/** 测试用：清缓存让下次调用重算 */
export function _resetDataPathsCache(): void {
  cached = null;
}
