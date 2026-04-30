import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { deriveKey, encryptSession, decryptSession } from '../crypto/session-crypto.util';
import { CreateProxyDto } from './dto/create-proxy.dto';
import { UpdateProxyDto } from './dto/update-proxy.dto';
import { Proxy, ProxyStatus } from './proxy.entity';

export interface ProxyTestResult {
  ok: boolean;
  latencyMs: number | null;
  externalIp: string | null;
  error: string | null;
  testedAt: string;
}

/**
 * Decrypted proxy connection params, ready for an MTProto client.
 * Used internally by the bind / agent paths; never returned to API clients.
 */
export interface DecryptedProxyConfig {
  type: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

@Injectable()
export class ProxiesService {
  private readonly logger = new Logger(ProxiesService.name);
  private readonly encKey: Buffer | null;

  constructor(
    @InjectRepository(Proxy)
    private readonly repo: Repository<Proxy>,
    private readonly config: ConfigService,
  ) {
    const raw = this.config.get<string>('SESSION_ENCRYPTION_KEY');
    this.encKey = raw ? deriveKey(raw) : null;
  }

  async create(dto: CreateProxyDto): Promise<Proxy> {
    const entity = this.repo.create({
      ...dto,
      passwordEncrypted: false,
    });
    if (dto.password && this.encKey) {
      entity.password = encryptSession(dto.password, this.encKey);
      entity.passwordEncrypted = true;
    }
    await this.repo.save(entity);
    return this.findOne(entity.id);
  }

  findAll(filters: { status?: ProxyStatus } = {}): Promise<Proxy[]> {
    const where: Partial<Pick<Proxy, 'status'>> = {};
    if (filters.status) where.status = filters.status;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Proxy> {
    const proxy = await this.repo.findOneBy({ id });
    if (!proxy) throw new NotFoundException(`Proxy ${id} not found`);
    return proxy;
  }

  async update(id: string, dto: UpdateProxyDto): Promise<Proxy> {
    const proxy = await this.findOne(id);
    const { password, ...rest } = dto;
    Object.assign(proxy, rest);
    if (password !== undefined) {
      if (password === '') {
        // Empty string clears the password
        proxy.password = '';
        proxy.passwordEncrypted = false;
      } else if (this.encKey) {
        proxy.password = encryptSession(password, this.encKey);
        proxy.passwordEncrypted = true;
      } else {
        proxy.password = password;
        proxy.passwordEncrypted = false;
      }
    }
    await this.repo.save(proxy);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const proxy = await this.findOne(id);
    await this.repo.remove(proxy);
  }

  /**
   * Test the proxy by making a real outbound HTTP request through it.
   * Returns latency + observed external IP. Updates proxy.status accordingly.
   */
  async test(id: string): Promise<ProxyTestResult> {
    const cfg = await this.getDecrypted(id);
    const proxyUrl = this.buildProxyUrl(cfg);
    const TARGETS = [
      'https://api.ipify.org?format=json',  // returns {ip:"..."}
      'https://ipinfo.io/json',              // returns {ip:"...",country:"..."}
    ];

    const startedAt = new Date().toISOString();
    let lastError: string | null = null;

    // Lazy-load proxy agent libs (CJS modules) — avoids ESM type-resolution gotchas in NestJS strict TS.
    const isSocks = cfg.type === 'socks5' || cfg.type === 'socks4';
    const agentModName = isSocks ? 'socks-proxy-agent' : 'https-proxy-agent';
    const agentClassName = isSocks ? 'SocksProxyAgent' : 'HttpsProxyAgent';
    let AgentClass: any;
    try {
      const mod = await import(agentModName);
      AgentClass = mod[agentClassName] ?? mod.default?.[agentClassName] ?? mod.default;
    } catch (err) {
      return {
        ok: false,
        latencyMs: null,
        externalIp: null,
        error: `Failed to load ${agentModName}: ${(err as Error).message}`,
        testedAt: startedAt,
      };
    }

    for (const target of TARGETS) {
      const t0 = Date.now();
      try {
        const agent = new AgentClass(proxyUrl);

        const res = await fetch(target, {
          // @ts-expect-error Node fetch supports `agent` via undici but typed for browser
          agent,
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          lastError = `HTTP ${res.status} from ${target}`;
          continue;
        }
        const body = await res.json() as { ip?: string };
        const latencyMs = Date.now() - t0;
        const externalIp = body.ip ?? null;

        // Persist last-known status + boundIp hint
        await this.repo.update(id, { status: ProxyStatus.ACTIVE });
        this.logger.log(`proxy ${id} test OK latency=${latencyMs}ms ip=${externalIp}`);
        return { ok: true, latencyMs, externalIp, error: null, testedAt: startedAt };
      } catch (err) {
        const e = err as Error;
        lastError = e.message ?? String(err);
        this.logger.warn(`proxy ${id} test failed via ${target}: ${lastError}`);
      }
    }

    await this.repo.update(id, { status: ProxyStatus.DEAD });
    return { ok: false, latencyMs: null, externalIp: null, error: lastError ?? 'unknown', testedAt: startedAt };
  }

  /** Build the proxy URL string used by the agent libs. */
  private buildProxyUrl(cfg: DecryptedProxyConfig): string {
    const auth = cfg.username
      ? `${encodeURIComponent(cfg.username)}${cfg.password ? ':' + encodeURIComponent(cfg.password) : ''}@`
      : '';
    const scheme = cfg.type.toLowerCase();  // socks5 / socks4 / http / https
    return `${scheme}://${auth}${cfg.host}:${cfg.port}`;
  }

  /**
   * Internal helper: load a proxy with its decrypted password.
   * Used by bind / agent paths to assemble a client-ready proxy config.
   */
  async getDecrypted(id: string): Promise<DecryptedProxyConfig> {
    const row = await this.repo.findOne({
      where: { id },
      select: ['id', 'type', 'host', 'port', 'username', 'password', 'passwordEncrypted'],
    });
    if (!row) throw new NotFoundException(`Proxy ${id} not found`);
    let password = row.password;
    if (row.password && row.passwordEncrypted && this.encKey) {
      password = decryptSession(row.password, this.encKey);
    }
    return {
      type: row.type,
      host: row.host,
      port: row.port,
      username: row.username,
      password,
    };
  }
}
