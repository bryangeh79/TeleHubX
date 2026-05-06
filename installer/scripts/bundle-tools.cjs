#!/usr/bin/env node
/**
 * 把 supervisor / stop 的多文件 TS 工程打成单文件 .cjs，供 Node SEA 注入。
 *
 * 输入: installer/tools/src/{supervisor,stop}.ts + shared/*.ts
 * 输出: installer/tools/dist-bundle/{supervisor,stop}.cjs
 *
 * 用 esbuild JS API（避免 .cmd 路径含空格的问题）。
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'installer', 'tools');
const OUT = path.join(TOOLS, 'dist-bundle');
fs.mkdirSync(OUT, { recursive: true });

// Resolve esbuild from installer/tools/node_modules
let esbuild;
try {
  esbuild = require(path.join(TOOLS, 'node_modules', 'esbuild'));
} catch (e) {
  console.error('[bundle] esbuild not installed in installer/tools.');
  console.error('Run: pnpm --filter @telehubx/installer-tools add -D esbuild');
  process.exit(1);
}

async function bundle(entry, out) {
  console.log(`[bundle] ${path.relative(ROOT, entry)} → ${path.relative(ROOT, out)}`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    outfile: out,
    logLevel: 'warning',
    // node: 内置模块自动 external 不打入
  });
}

(async () => {
  try {
    await bundle(path.join(TOOLS, 'src/supervisor.ts'), path.join(OUT, 'supervisor.cjs'));
    await bundle(path.join(TOOLS, 'src/stop.ts'),       path.join(OUT, 'stop.cjs'));
    const supSize = fs.statSync(path.join(OUT, 'supervisor.cjs')).size;
    const stopSize = fs.statSync(path.join(OUT, 'stop.cjs')).size;
    console.log(`[bundle] supervisor.cjs ${(supSize/1024).toFixed(1)} KB`);
    console.log(`[bundle] stop.cjs       ${(stopSize/1024).toFixed(1)} KB`);
    console.log('[bundle] done');
  } catch (e) {
    console.error('[bundle] failed:', e.message ?? e);
    process.exit(1);
  }
})();
