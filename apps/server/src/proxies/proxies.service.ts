import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { deriveKey, encryptSession, decryptSession } from '../crypto/session-crypto.util';
import { CreateProxyDto } from './dto/create-proxy.dto';
import { UpdateProxyDto } from './dto/update-proxy.dto';
import { Proxy, ProxyStatus } from './proxy.entity';

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
