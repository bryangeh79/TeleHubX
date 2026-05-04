import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Codex round-11 #1: 同时加载根目录 .env 和 apps/server/.env, 与 NestJS app.module 保持一致
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Codex round-11 #1: 与 app.module.ts 统一 ENV 命名 (DB_* 优先, PG_* 兼容)
// 之前 data-source 用 PG_*, app 用 DB_*, 导致 migration CLI 可能指向错误 DB
export const AppDataSource = new DataSource({
  type: 'postgres',
  host:     process.env.DB_HOST     ?? process.env.PG_HOST     ?? 'localhost',
  port:     parseInt(process.env.DB_PORT ?? process.env.PG_PORT ?? '5436', 10),
  username: process.env.DB_USER     ?? process.env.PG_USER     ?? 'telehubx',
  password: process.env.DB_PASSWORD ?? process.env.PG_PASSWORD ?? 'telehubx',
  database: process.env.DB_NAME     ?? process.env.PG_DATABASE ?? 'telehubx',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,    // migration CLI 永不 synchronize
  logging: process.env.NODE_ENV === 'development',
});
