#!/usr/bin/env node
/**
 * Minimal SPA static server for dashboard prod build.
 *
 * - Serves files from ./dist (relative to this file)
 * - SPA fallback: any unknown route without a file extension → index.html
 * - Loopback only (127.0.0.1) for security
 * - No external deps (uses only node: builtins) — Phase 4 SEA friendly
 *
 * Env:
 *   DASHBOARD_PORT (default 9601)
 *   DASHBOARD_HOST (default 127.0.0.1)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const PORT = Number(process.env.DASHBOARD_PORT || 9601);
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const ROOT = path.resolve(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
};

function safeJoin(root, reqPath) {
  // Normalize and prevent path traversal
  const cleaned = decodeURIComponent(reqPath).replace(/\\/g, '/').replace(/\/+/g, '/');
  const joined = path.normalize(path.join(root, cleaned));
  if (!joined.startsWith(root)) return null;
  return joined;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body && typeof body.pipe === 'function') body.pipe(res);
  else res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method not allowed');
  }
  const parsed = url.parse(req.url || '/');
  let filePath = safeJoin(ROOT, parsed.pathname || '/');
  if (!filePath) return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad path');

  let stat;
  try { stat = fs.statSync(filePath); } catch { stat = null; }

  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }

  if (!stat) {
    // SPA fallback: no extension → serve index.html
    if (path.extname(parsed.pathname || '') === '') {
      filePath = path.join(ROOT, 'index.html');
      try { stat = fs.statSync(filePath); } catch { stat = null; }
    }
    if (!stat) {
      return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  };

  if (req.method === 'HEAD') return send(res, 200, headers, null);
  send(res, 200, headers, fs.createReadStream(filePath));
});

server.listen(PORT, HOST, () => {
  console.log(`[dashboard] static server listening on http://${HOST}:${PORT}`);
  console.log(`[dashboard] root: ${ROOT}`);
});

// Graceful shutdown on SIGTERM (taskkill /T sends to children — give them a chance)
function shutdown(sig) {
  console.log(`[dashboard] received ${sig}, closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
