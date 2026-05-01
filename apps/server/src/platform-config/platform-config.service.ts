import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformAiConfig } from './platform-ai-config.entity';

@Injectable()
export class PlatformConfigService {
  constructor(
    @InjectRepository(PlatformAiConfig)
    private readonly repo: Repository<PlatformAiConfig>,
  ) {}

  /** List all providers (apiKey masked) */
  async listProviders(): Promise<Omit<PlatformAiConfig, 'apiKey'>[]> {
    const rows = await this.repo.find({ order: { isDefault: 'DESC', createdAt: 'ASC' } });
    return rows.map(r => {
      const { apiKey: _, ...rest } = r as any;
      return rest;
    });
  }

  /** Get the active default provider WITH apiKey (internal use only) */
  async getDefaultProvider(): Promise<PlatformAiConfig | null> {
    return this.repo
      .createQueryBuilder('p')
      .addSelect('p.apiKey')
      .where('p.isDefault = true AND p.isActive = true')
      .getOne();
  }

  /** Create new provider config */
  async createProvider(dto: {
    provider: string;
    name?: string;
    apiKey: string;
    model?: string;
    baseUrl?: string;
    isDefault?: boolean;
  }): Promise<Omit<PlatformAiConfig, 'apiKey'>> {
    // Only one default allowed
    if (dto.isDefault) {
      await this.repo.update({ isDefault: true }, { isDefault: false });
    }
    const saved = await this.repo.save(this.repo.create(dto as Partial<PlatformAiConfig>));
    const { apiKey: _, ...rest } = saved as any;
    return rest;
  }

  async updateProvider(id: string, dto: {
    provider?: string;
    name?: string;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    isDefault?: boolean;
    isActive?: boolean;
  }): Promise<Omit<PlatformAiConfig, 'apiKey'>> {
    const config = await this.repo
      .createQueryBuilder('p')
      .addSelect('p.apiKey')
      .where('p.id = :id', { id })
      .getOne();
    if (!config) throw new NotFoundException(`PlatformAiConfig ${id} not found`);

    if (dto.isDefault && !config.isDefault) {
      await this.repo.update({ isDefault: true }, { isDefault: false });
    }

    // Don't overwrite key if not provided
    if (!dto.apiKey) delete dto.apiKey;
    Object.assign(config, dto);
    const saved = await this.repo.save(config);
    const { apiKey: _, ...rest } = saved as any;
    return rest;
  }

  async deleteProvider(id: string): Promise<void> {
    const config = await this.repo.findOneBy({ id });
    if (!config) throw new NotFoundException(`PlatformAiConfig ${id} not found`);
    await this.repo.remove(config);
  }

  async testConnection(id: string): Promise<{ ok: boolean; message: string }> {
    // Actual test done in AiAgentService; here we just update timestamps
    const config = await this.repo.findOneBy({ id });
    if (!config) throw new NotFoundException();
    config.lastTestedAt = new Date();
    // Status updated by caller after actual test
    await this.repo.save(config);
    return { ok: true, message: 'pending' };
  }

  async recordTestResult(id: string, ok: boolean): Promise<void> {
    await this.repo.update({ id }, {
      lastTestedAt: new Date(),
      lastTestStatus: ok ? 'ok' : 'fail',
    });
  }
}
