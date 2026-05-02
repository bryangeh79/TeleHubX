import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformAiConfig } from './platform-ai-config.entity';
import { PlatformSetting } from './platform-setting.entity';

/** 默认变体生成 Prompt，用 {content} / {count} 占位 */
export const DEFAULT_VARIANT_PROMPT = `你是专业广告文案优化师。
原始文案：
---
{content}
---
请生成 {count} 条变体，要求：
1. 保持核心卖点不变，在句式、emoji、标点上有明显差异
2. 每条与原文相似度 < 70%
3. 语言与原文一致（中文/英文/马来文）
4. 保留原文所有联系方式（链接/电话/账号）完全不改
5. 不加编号或前缀
6. 【重要】严格保留原文的段落结构和换行格式：原文有几个段落，变体也要有几个段落；列表项（✅ 开头的行）每条单独一行，不得合并成一段
7. JSON 字符串内用 \\n 表示换行，段落之间用 \\n\\n 分隔

以 JSON 数组格式输出，只输出纯 JSON，不要任何解释或 markdown：
["变体1内容", "变体2内容", ..., "变体{count}内容"]`;

@Injectable()
export class PlatformConfigService {
  constructor(
    @InjectRepository(PlatformAiConfig)
    private readonly repo: Repository<PlatformAiConfig>,
    @InjectRepository(PlatformSetting)
    private readonly settingRepo: Repository<PlatformSetting>,
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

  // ── Platform KV Settings ─────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    const row = await this.settingRepo.findOneBy({ key });
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.settingRepo.upsert({ key, value }, ['key']);
  }

  /** 取变体 Prompt 模板，未设置时返回内置默认值 */
  async getVariantPrompt(): Promise<string> {
    return (await this.getSetting('variant_prompt_template')) ?? DEFAULT_VARIANT_PROMPT;
  }

  /** 重置变体 Prompt 为内置默认 */
  async resetVariantPrompt(): Promise<void> {
    await this.setSetting('variant_prompt_template', DEFAULT_VARIANT_PROMPT);
  }
}
