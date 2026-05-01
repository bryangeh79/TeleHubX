/* eslint-disable */
/**
 * 一次性 importer：扫描 data/assets/ 把 WAhubX 复用过来的 712 MB 素材
 * 注册到 PG `assets` 表（builtin pool，所有租户共享）。
 *
 * 用法：
 *   cd apps/server
 *   pnpm import:assets
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
const ASSETS_ROOT = path.join(DATA_ROOT, 'assets');

require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

const SUFFIX_TO_CATEGORY = {
  '.jpg': 'photo', '.jpeg': 'photo', '.png': 'photo', '.webp': 'photo', '.gif': 'photo',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video',
  '.ogg': 'voice', '.opus': 'voice', '.mp3': 'voice', '.m4a': 'voice', '.wav': 'voice',
};
const SUFFIX_TO_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.ogg': 'audio/ogg', '.opus': 'audio/opus', '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav',
};

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

function scan(root) {
  const rows = [];
  for (const file of walk(root)) {
    const ext = path.extname(file).toLowerCase();
    const cat = SUFFIX_TO_CATEGORY[ext];
    if (!cat) continue;
    const rel = path.relative(DATA_ROOT, file).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts.length < 4) continue;
    const [, mediaType, sub] = parts;
    const poolName = `_builtin_${mediaType}_${sub}`;
    rows.push({
      category: cat,
      poolName,
      fileName: path.basename(file),
      relativePath: rel,
      byteSize: fs.statSync(file).size,
      mimeType: SUFFIX_TO_MIME[ext] || null,
    });
  }
  return rows;
}

async function main() {
  if (!fs.existsSync(ASSETS_ROOT)) {
    console.error(`assets root not found: ${ASSETS_ROOT}`);
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

  const rows = scan(ASSETS_ROOT);
  console.log(`Scanned ${rows.length} files under ${ASSETS_ROOT}`);

  const counts = {};
  for (const r of rows) counts[r.poolName] = (counts[r.poolName] || 0) + 1;
  console.log('Pool breakdown:');
  Object.entries(counts).sort().forEach(([p, n]) => console.log(`  ${p}: ${n}`));

  let inserted = 0, skipped = 0;
  for (const r of rows) {
    const existing = await client.query(
      `SELECT id FROM assets WHERE "poolName"=$1 AND "fileName"=$2 AND source='builtin'`,
      [r.poolName, r.fileName],
    );
    if (existing.rowCount > 0) { skipped++; continue; }

    const tags = [r.poolName.replace('_builtin_', '')];
    await client.query(
      `INSERT INTO assets
        ("tenantId", source, "poolName", "relativePath", category, "fileName",
         "mimeType", "byteSize", enabled, tags, description, "createdAt", "updatedAt")
       VALUES (NULL, 'builtin', $1, $2, $3, $4, $5, $6, true, $7, $8, NOW(), NOW())`,
      [r.poolName, r.relativePath, r.category, r.fileName, r.mimeType, r.byteSize,
       tags.join(','), `WAhubX 复用素材（${r.poolName}）`],
    );
    inserted++;
  }

  console.log(`\nDone. inserted=${inserted}, skipped(existing)=${skipped}, total=${rows.length}`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
