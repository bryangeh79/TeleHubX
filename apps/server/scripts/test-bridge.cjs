// Standalone test for HttpToSocks5Bridge.
// Usage: node scripts/test-bridge.cjs <proxy-id-from-db>
// 流程: 1) 从 dist 加载 bridge 类  2) 直连用户的 HTTP proxy 起本地 SOCKS5
//      3) 通过本地 SOCKS5 连 api.ipify.org 拉外网 IP 验证隧道

const net = require('net');
const { Client } = require('pg');
const crypto = require('crypto');

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5436', 10),
  user: process.env.DB_USER || 'telehubx',
  password: process.env.DB_PASSWORD || 'telehubx',
  database: process.env.DB_NAME || 'telehubx',
};

const ENC_KEY = process.env.SESSION_ENCRYPTION_KEY;
const SALT = 'telehubx-session-v1';

function decrypt(b64, key) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

async function main() {
  const proxyId = process.argv[2];
  if (!proxyId) {
    console.error('Usage: node test-bridge.cjs <proxy-id>');
    process.exit(1);
  }

  const pg = new Client(DB);
  await pg.connect();
  const r = await pg.query('SELECT * FROM proxies WHERE id=$1', [proxyId]);
  await pg.end();
  if (!r.rows.length) {
    console.error('proxy not found');
    process.exit(2);
  }
  const p = r.rows[0];
  let pwd = p.password;
  // PG lowercases unquoted column names; TypeORM stores as 'passwordencrypted'
  const isEncrypted = p.passwordencrypted ?? p.password_encrypted ?? p.passwordEncrypted;
  if (isEncrypted && ENC_KEY) {
    const key = crypto.scryptSync(ENC_KEY, SALT, 32);
    pwd = decrypt(p.password, key);
  }
  console.log(`proxy: ${p.type}://${p.host}:${p.port} user=${p.username} pwdLen=${pwd ? pwd.length : 0} pwdHead=${pwd ? pwd.slice(0,4)+'...' : 'NONE'}`);

  const { HttpToSocks5Bridge } = require('../dist/proxies/http-to-socks5.bridge.js');
  const bridge = new HttpToSocks5Bridge(
    { host: p.host, port: p.port, username: p.username, password: pwd, scheme: p.type },
    'test',
  );
  const addr = await bridge.start();
  console.log(`bridge listening on ${addr.host}:${addr.port}`);
  console.log('--- step 1: connecting to local SOCKS5 bridge ---');

  // Now connect via SOCKS5 to api.ipify.org:443 → send HTTP/1.1 GET → read response
  const sock = net.connect(addr.port, addr.host);
  sock.on('error', (err) => console.error('client sock error:', err.message));
  await new Promise((r) => sock.on('connect', r));
  console.log('--- step 2: TCP connected to bridge, sending SOCKS5 greeting ---');

  // SOCKS5 greeting
  sock.write(Buffer.from([0x05, 0x01, 0x00]));
  await new Promise((res, rej) => {
    sock.once('data', (b) => {
      if (b[0] === 0x05 && b[1] === 0x00) res();
      else rej(new Error('SOCKS5 greet failed: ' + b.toString('hex')));
    });
  });
  console.log('--- step 3: greeting OK, sending CONNECT api.ipify.org:443 ---');

  // SOCKS5 CONNECT api.ipify.org:443
  const host = 'api.ipify.org';
  const port = 443;
  const req = Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
    Buffer.from(host),
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
  ]);
  sock.write(req);
  await new Promise((res, rej) => {
    sock.once('data', (b) => {
      console.log(`--- step 4: got SOCKS5 reply: ${b.slice(0, 4).toString('hex')} ---`);
      if (b[0] === 0x05 && b[1] === 0x00) res();
      else rej(new Error('SOCKS5 CONNECT failed: ' + b.toString('hex')));
    });
  });
  console.log('--- step 5: SOCKS5 tunnel established, doing TLS handshake ---');

  // Wrap socket in TLS and do GET
  const tls = require('tls');
  const tlsSock = tls.connect({ socket: sock, servername: host, ALPNProtocols: ['http/1.1'] });
  await new Promise((r, j) => {
    tlsSock.once('secureConnect', r);
    tlsSock.once('error', j);
  });

  tlsSock.write(`GET /?format=json HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  let body = '';
  tlsSock.on('data', (d) => (body += d.toString('utf8')));
  await new Promise((r) => tlsSock.on('end', r));

  const idx = body.indexOf('\r\n\r\n');
  const json = idx >= 0 ? body.slice(idx + 4) : body;
  console.log('--- response body ---');
  console.log(json);

  await bridge.stop();
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
