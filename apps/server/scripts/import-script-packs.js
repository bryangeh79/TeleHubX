/* eslint-disable */
/**
 * 导入 WAhubX 复用过来的剧本包 (data/script-packs/*.json) 到 chat_scripts 表。
 *
 * 用法：
 *   cd apps/server
 *   pnpm import:scripts
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKS_ROOT = path.join(PROJECT_ROOT, 'data', 'script-packs');

require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

function flattenSessionsToLines(sessions) {
  const lines = [];
  for (const s of sessions) {
    for (const t of s.turns) {
      let text = '';
      if (t.content_pool && t.content_pool.length) text = t.content_pool[0];
      else if (t.caption_pool && t.caption_pool.length) text = t.caption_pool[0];
      else if (t.caption_fallback) text = t.caption_fallback;
      else if (t.asset_pool) text = `[${t.type}: ${t.asset_pool}]`;
      else text = '...';

      const sendDelay = t.send_delay_sec || [30, 90];
      const meanMs = ((sendDelay[0] + sendDelay[1]) / 2) * 1000;
      const stdMs = ((sendDelay[1] - sendDelay[0]) / 4) * 1000;

      lines.push({
        roleLabel: t.role,
        text,
        allowEmoji: true,
        delayAfterMs: Math.round(meanMs),
        delayStdDevMs: Math.round(stdMs),
      });
    }
  }
  return lines;
}

function detectType(scripts) {
  const roles = new Set();
  for (const s of scripts.slice(0, 1)) {
    for (const sess of s.sessions) for (const t of sess.turns) roles.add(t.role);
  }
  return roles.size > 2 ? 'A+B+C+D' : 'A+B';
}

async function main() {
  if (!fs.existsSync(PACKS_ROOT)) {
    console.error(`packs root not found: ${PACKS_ROOT}`);
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5436', 10),
    user: process.env.DB_USER || 'telehubx',
    password: process.env.DB_PASSWORD || 'telehubx',
    database: process.env.DB_NAME || 'telehubx',
  });
  await client.connect();

  const files = fs.readdirSync(PACKS_ROOT).filter((f) => f.endsWith('.json')).sort();
  console.log(`Found ${files.length} pack file(s)`);

  let totalInserted = 0, totalSkipped = 0;

  for (const f of files) {
    const blob = JSON.parse(fs.readFileSync(path.join(PACKS_ROOT, f), 'utf-8'));
    if (!blob.scripts) {
      console.log(`  ${f}: no scripts[], skipping`);
      continue;
    }
    // 主 pack 用 pack_id；增量 batch 用 pack_ref 回填到同一 pack
    const packId = blob.pack_id || blob.pack_ref || null;
    const packType = detectType(blob.scripts);
    let inserted = 0, skipped = 0, fixed = 0;

    for (const s of blob.scripts) {
      // 先尝试用 packId+name 匹配
      let existing = await client.query(
        `SELECT id, "packId" FROM chat_scripts WHERE "packId"=$1 AND name=$2`,
        [packId, s.name],
      );
      if (existing.rowCount === 0) {
        // 再尝试匹配 packId 为 NULL 的同名记录（老数据回填）
        existing = await client.query(
          `SELECT id, "packId" FROM chat_scripts WHERE "packId" IS NULL AND name=$1`,
          [s.name],
        );
        if (existing.rowCount > 0) {
          await client.query(`UPDATE chat_scripts SET "packId"=$1 WHERE id=$2`, [packId, existing.rows[0].id]);
          fixed++;
          continue;
        }
      }
      if (existing.rowCount > 0) { skipped++; continue; }

      const lines = flattenSessionsToLines(s.sessions);
      const totalTurns = s.total_turns || lines.length;
      const minRound = Math.max(2, Math.floor(totalTurns * 0.7));

      await client.query(
        `INSERT INTO chat_scripts
          ("tenantId", name, type, "minRound", "maxRound", "groupIds", "accountIds",
           lines, "packId", category, "rawScript", status, "executedCount",
           "createdAt", "updatedAt")
         VALUES (NULL, $1, $2, $3, $4, '', '', $5, $6, $7, $8, 'active', 0, NOW(), NOW())`,
        [s.name, packType, minRound, totalTurns,
         JSON.stringify(lines), packId, s.category || null, JSON.stringify(s)],
      );
      inserted++;
    }
    totalInserted += inserted;
    totalSkipped += skipped;
    console.log(`  ${f} (pack=${packId}): inserted=${inserted}, skipped=${skipped}, fixed=${fixed}`);
  }

  console.log(`\nDone. inserted=${totalInserted}, skipped=${totalSkipped}`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
