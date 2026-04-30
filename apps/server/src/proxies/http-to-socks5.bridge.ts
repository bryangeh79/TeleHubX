import { Logger } from '@nestjs/common';
import * as net from 'node:net';

/**
 * 本地 SOCKS5 监听 → HTTP CONNECT 隧道桥。
 *
 * 用途：GramJS MTProto 仅支持 SOCKS4/5，但很多代理服务商只给 HTTP 端点。
 * 此桥在 127.0.0.1 起一个 SOCKS5 监听，对每个 SOCKS5 CONNECT 请求，
 * 通过 HTTP CONNECT 方法转发到上游 HTTP 代理。
 *
 * 协议参考：
 *  - SOCKS5: RFC 1928 (greeting + connect)
 *  - HTTP CONNECT: RFC 7231 §4.3.6
 */

export interface HttpProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** 'http' or 'https'. https 暂未实现 (需要 TLS 握手到代理), 暂当 http 处理. */
  scheme?: 'http' | 'https';
}

export interface BridgeAddress {
  host: string;
  port: number;
}

export class HttpToSocks5Bridge {
  private server: net.Server | null = null;
  private port = 0;
  private readonly logger: Logger;

  constructor(
    private readonly upstream: HttpProxyConfig,
    label = 'bridge',
  ) {
    this.logger = new Logger(`HttpToSocks5Bridge[${label}]`);
  }

  async start(): Promise<BridgeAddress> {
    if (this.server) return { host: '127.0.0.1', port: this.port };

    this.server = net.createServer((sock) => {
      this.handleClient(sock).catch((err) => {
        this.logger.warn(`client error: ${(err as Error).message}`);
        sock.destroy();
      });
    });
    this.server.on('error', (err) => this.logger.error(`server error: ${err.message}`));

    return new Promise<BridgeAddress>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as net.AddressInfo;
        this.port = addr.port;
        this.logger.log(`listening on 127.0.0.1:${this.port} → http://${this.upstream.host}:${this.upstream.port}`);
        resolve({ host: '127.0.0.1', port: this.port });
      });
      this.server!.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }

  // ── SOCKS5 protocol ──────────────────────────────────────────────────────

  private async handleClient(client: net.Socket): Promise<void> {
    client.on('error', (err) => this.logger.warn(`client socket error: ${err.message}`));

    // 单一 buffer + 一个 'data' 监听器，避免 unshift/removeListener 的 race。
    let inbox = Buffer.alloc(0);
    const waiters: Array<{ n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void }> = [];

    const drainWaiters = () => {
      while (waiters.length && inbox.length >= waiters[0].n) {
        const w = waiters.shift()!;
        const out = inbox.subarray(0, w.n);
        inbox = inbox.subarray(w.n);
        w.resolve(out);
      }
    };

    client.on('data', (chunk: Buffer) => {
      inbox = Buffer.concat([inbox, chunk]);
      drainWaiters();
    });
    const fail = (err: Error) => {
      while (waiters.length) waiters.shift()!.reject(err);
    };
    client.once('end', () => fail(new Error('client closed')));
    client.once('close', () => fail(new Error('client closed')));

    const read = (n: number): Promise<Buffer> => new Promise((resolve, reject) => {
      waiters.push({ n, resolve, reject });
      drainWaiters();
    });

    try {
      // Step 1: greeting
      const greet = await read(2);
      if (greet[0] !== 0x05) {
        this.logger.warn(`bad SOCKS version: ${greet[0]}`);
        client.destroy();
        return;
      }
      const nMethods = greet[1];
      if (nMethods > 0) await read(nMethods);
      client.write(Buffer.from([0x05, 0x00]));

      // Step 2: connect request
      const head = await read(4);
      if (head[0] !== 0x05 || head[1] !== 0x01) {
        this.logger.warn(`unsupported cmd: ${head[1]}`);
        client.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.destroy();
        return;
      }

      const atyp = head[3];
      let host: string;
      if (atyp === 0x01) {
        const ip = await read(4);
        host = `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}`;
      } else if (atyp === 0x03) {
        const lenBuf = await read(1);
        const name = await read(lenBuf[0]);
        host = name.toString('utf8');
      } else if (atyp === 0x04) {
        const ipv6 = await read(16);
        host = '[' + Array.from({ length: 8 }, (_, i) => ipv6.readUInt16BE(i * 2).toString(16)).join(':') + ']';
      } else {
        this.logger.warn(`unsupported atyp: ${atyp}`);
        client.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.destroy();
        return;
      }
      const portBuf = await read(2);
      const targetPort = portBuf.readUInt16BE(0);

      this.logger.log(`CONNECT ${host}:${targetPort}`);

      // Step 3: open HTTP CONNECT to upstream
      let upstream: net.Socket;
      try {
        upstream = await this.openHttpTunnel(host, targetPort);
      } catch (err) {
        this.logger.warn(`HTTP tunnel failed: ${(err as Error).message}`);
        client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        client.destroy();
        return;
      }

      // Step 4: success reply
      client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));

      // Step 5: 飞 inbox 残余的字节给 upstream（如果 SOCKS5 客户端在收到 connect-success
      // 之前已经发了 application data，它会进 inbox）
      if (inbox.length) {
        upstream.write(inbox);
        inbox = Buffer.alloc(0);
      }

      // 之后 client 的所有字节都给 upstream，移除我们的 data 监听器
      client.removeAllListeners('data');
      upstream.on('error', (err) => this.logger.warn(`upstream error: ${err.message}`));
      upstream.on('end', () => client.end());
      client.on('end', () => upstream.end());
      upstream.pipe(client);
      client.pipe(upstream);
    } catch (err) {
      this.logger.warn(`handleClient: ${(err as Error).message}`);
      try { client.destroy(); } catch {}
    }
  }

  // ── HTTP CONNECT to upstream ─────────────────────────────────────────────

  private openHttpTunnel(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.upstream.port, this.upstream.host);
      let buf = '';
      const ABORT_MS = 15_000;
      const timer = setTimeout(() => {
        sock.destroy(new Error('HTTP CONNECT timeout'));
      }, ABORT_MS);

      sock.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      sock.on('connect', () => {
        const auth = this.upstream.username
          ? 'Proxy-Authorization: Basic ' +
            Buffer.from(`${this.upstream.username}:${this.upstream.password ?? ''}`).toString('base64') +
            '\r\n'
          : '';
        const req =
          `CONNECT ${host}:${port} HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          auth +
          `\r\n`;
        sock.write(req);
      });

      const onData = (chunk: Buffer) => {
        buf += chunk.toString('latin1');
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        // header complete
        sock.removeListener('data', onData);
        clearTimeout(timer);
        const status = /^HTTP\/1\.[01] (\d{3}) (.*)/.exec(buf);
        if (!status) {
          reject(new Error(`Bad CONNECT response: ${buf.slice(0, 80)}`));
          sock.destroy();
          return;
        }
        const code = parseInt(status[1], 10);
        if (code !== 200) {
          // dump full headers for debugging
          this.logger.warn(`HTTP CONNECT rejected ${code}, full response:\n${buf.slice(0, 600)}`);
          reject(new Error(`HTTP CONNECT rejected ${code} ${status[2]}`));
          sock.destroy();
          return;
        }
        // Replay any extra data after \r\n\r\n? Length usually 0 for CONNECT but be safe:
        const headerLen = idx + 4;
        const total = Buffer.byteLength(buf, 'latin1');
        if (total > headerLen) {
          // Push leftover back into stream
          sock.unshift(Buffer.from(buf.slice(headerLen), 'latin1'));
        }
        resolve(sock);
      };
      sock.on('data', onData);
    });
  }
}

