/**
 * 一次性种子脚本: 把 10 份平台默认 6 人剧本灌进 chat_scripts 表 (tenantId=null).
 *
 * 用法: cd apps/server && npx tsx scripts/seed-builtin-6p.ts
 *
 * 幂等 — packId='_builtin_default_6p_v1' 已存在则跳过.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Client } from 'pg';
import { SeedBuiltin6pChatScripts1730600000000 } from '../src/database/migrations/1730600000000-seed-builtin-6p-chat-scripts';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

async function main() {
  const client = new Client({
    host: process.env.DB_HOST ?? process.env.PG_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? process.env.PG_PORT ?? '5436', 10),
    user: process.env.DB_USER ?? process.env.PG_USER ?? 'telehubx',
    password: process.env.DB_PASSWORD ?? process.env.PG_PASSWORD ?? 'telehubx',
    database: process.env.DB_NAME ?? process.env.PG_DATABASE ?? 'telehubx',
  });
  await client.connect();
  console.log(`[seed-6p] connected to ${client.host}:${client.port}/${client.database}`);

  // 已存在 → 跳过
  const exists = await client.query(
    `SELECT COUNT(*)::int AS n FROM chat_scripts WHERE "packId" = $1`,
    ['_builtin_default_6p_v1'],
  );
  if (exists.rows[0]?.n > 0) {
    console.log(`[seed-6p] 已存在 ${exists.rows[0].n} 份 builtin 6p 剧本, 跳过`);
    await client.end();
    return;
  }

  // 调 migration 的 up() — 但它要求 QueryRunner. 我们直接执行 INSERT.
  // 复用 migration 文件里的 SCRIPTS 数组需要 export, 这里直接抄一份 简化策略:
  // 直接 require migration 模块, 用反射拿 SCRIPTS — 不行, SCRIPTS 是局部 const.
  //
  // 改成: 让 migration 文件 export SCRIPTS, 这里 import.
  const { SCRIPTS_FOR_SEED } = await import('../src/database/migrations/1730600000000-seed-builtin-6p-chat-scripts.js')
    .catch(() => import('../src/database/migrations/1730600000000-seed-builtin-6p-chat-scripts'));

  let n = 0;
  for (const script of SCRIPTS_FOR_SEED) {
    const lines: any[] = [];
    for (const sess of script.rawScript.sessions) {
      for (const t of sess.turns) {
        lines.push({
          roleLabel: t.role,
          text: t.content_pool[0] ?? '',
          allowEmoji: true,
          delayAfterMs: (t.send_delay_sec[0] ?? 30) * 1000,
          delayStdDevMs: 5000,
        });
      }
    }
    await client.query(
      `INSERT INTO chat_scripts
        ("tenantId","name","type","minRound","maxRound","groupIds","accountIds",
         "lines","packId","category","rawScript","status","executedCount")
       VALUES (NULL,$1,$2,$3,$4,NULL,NULL,$5::jsonb,$6,$7,$8::jsonb,'active',0)`,
      [
        script.name,
        'A+B+C+D+E+F',
        script.minRound,
        script.maxRound,
        JSON.stringify(lines),
        '_builtin_default_6p_v1',
        script.category,
        JSON.stringify(script.rawScript),
      ],
    );
    n += 1;
    console.log(`[seed-6p] (${n}/${SCRIPTS_FOR_SEED.length}) ${script.name}`);
  }

  console.log(`[seed-6p] 完成 — 共插入 ${n} 份 6 人剧本`);
  await client.end();
}

main().catch(async (err) => {
  console.error('[seed-6p] FAILED:', err);
  process.exit(1);
});
