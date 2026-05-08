#!/usr/bin/env node
/**
 * Minimal SPA static server for dashboard prod build.
 *
 * - Serves files from ./dist (relative to this file)
 * - SPA fallback: any unknown route without a file extension → index.html
 * - Reverse-proxy: /api/*, /ws/* and /socket.io/* → 127.0.0.1:9800
 *     Vite dev server has this proxy in vite.config.ts; the production
 *     static server must replicate it or every browser request to
 *     `${origin}/api/...` lands on this 9601 server and gets 405.
 *     (Issue #23 / vmfix16: License activation 405 fix.)
 * - Loopback only (127.0.0.1) for security
 * - No external deps (uses only node: builtins) — Phase 4 SEA friendly
 *
 * Env:
 *   DASHBOARD_PORT (default 9601)
 *   DASHBOARD_HOST (default 127.0.0.1)
 *   BACKEND_HOST   (default 127.0.0.1)
 *   BACKEND_PORT   (default 9800)
 */
'use strict';

const http = require('node:http');
const net  = require('node:net');
const fs   = require('node:fs');
const path = require('node:path');
const url  = require('node:url');

const PORT = Number(process.env.DASHBOARD_PORT || 9601);
const HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 9800);
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

function isProxyPath(p) {
  return p === '/api' || p === '/ws' || p === '/socket.io'
      || p.startsWith('/api/')
      || p.startsWith('/ws/')
      || p.startsWith('/socket.io/');
}

// ── HTTP reverse proxy for /api/* (any method) ─────────────────────────────
function proxyHttp(req, res) {
  // Forward headers as-is, but rewrite Host so the upstream sees its own
  // bind address (some frameworks generate redirects/links from Host).
  const headers = { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` };

  const upstream = http.request(
    {
      host: BACKEND_HOST,
      port: BACKEND_PORT,
      method: req.method,
      path: req.url,
      headers,
    },
    (upRes) => {
      // Copy status + headers verbatim, then pipe body.
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    console.error(`[dashboard] proxy error ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      send(
        res,
        502,
        { 'Content-Type': 'application/json; charset=utf-8' },
        JSON.stringify({ statusCode: 502, message: 'Bad Gateway (backend unreachable)', error: err.code || 'EPROXY' }),
      );
    } else {
      try { res.end(); } catch { /* ignore */ }
    }
  });

  // Pipe client body (POST/PUT/PATCH) to upstream. For GET/HEAD this is a no-op.
  req.pipe(upstream);

  // If the client aborts mid-flight, tear down the upstream socket too.
  req.on('aborted', () => upstream.destroy());
}

// ── WebSocket upgrade proxy for /ws/* ──────────────────────────────────────
function proxyUpgrade(req, clientSocket, head) {
  // Open a raw TCP socket to the backend and replay the HTTP/1.1 upgrade
  // handshake byte-for-byte. Pipe both directions afterward.
  const upstream = net.connect(BACKEND_PORT, BACKEND_HOST, () => {
    // Rebuild request line + headers
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    const hdrs = { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` };
    for (const [k, v] of Object.entries(hdrs)) {
      if (Array.isArray(v)) {
        for (const vv of v) lines.push(`${k}: ${vv}`);
      } else if (v !== undefined) {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push('', '');
    upstream.write(lines.join('\r\n'));
    if (head && head.length) upstream.write(head);

    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  function tearDown(err) {
    if (err) console.error(`[dashboard] ws proxy error: ${err.message}`);
    try { upstream.destroy(); } catch { /* ignore */ }
    try { clientSocket.destroy(); } catch { /* ignore */ }
  }
  upstream.on('error', tearDown);
  clientSocket.on('error', tearDown);
}

// ── server ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url || '/');
  const pathname = parsed.pathname || '/';

  // 1. Reverse-proxy backend paths first (any method allowed).
  if (isProxyPath(pathname)) {
    return proxyHttp(req, res);
  }

  // 2. Static file serving is GET/HEAD only.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { 'Content-Type': 'text/plain' }, 'Method not allowed');
  }

  let filePath = safeJoin(ROOT, pathname);
  if (!filePath) return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad path');

  let stat;
  try { stat = fs.statSync(filePath); } catch { stat = null; }

  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }

  if (!stat) {
    // SPA fallback: no extension → serve index.html
    if (path.extname(pathname) === '') {
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

// HTTP/1.1 upgrade (WebSocket) — Node emits 'upgrade' separately from 'request'
server.on('upgrade', (req, socket, head) => {
  const parsed = url.parse(req.url || '/');
  const pathname = parsed.pathname || '/';
  if (isProxyPath(pathname)) {
    return proxyUpgrade(req, socket, head);
  }
  // Anything else trying to upgrade against the static server is a bug.
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`[dashboard] static server listening on http://${HOST}:${PORT}`);
  console.log(`[dashboard] root: ${ROOT}`);
  console.log(`[dashboard] proxying /api/*, /ws/*, /socket.io/* -> http://${BACKEND_HOST}:${BACKEND_PORT}`);
});

// Graceful shutdown on SIGTERM (taskkill /T sends to children — give them a chance)
function shutdown(sig) {
  console.log(`[dashboard] received ${sig}, closing server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
