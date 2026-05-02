import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { AdTemplate } from './ad-template.entity';
import { CreateAdTemplateDto } from './dto/create-ad-template.dto';
import { UpdateAdTemplateDto } from './dto/update-ad-template.dto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';

@Injectable()
export class AdTemplatesService {
  private readonly logger = new Logger(AdTemplatesService.name);

  constructor(
    @InjectRepository(AdTemplate)
    private readonly repo: Repository<AdTemplate>,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  create(dto: CreateAdTemplateDto): Promise<AdTemplate> {
    return this.repo.save(this.repo.create(dto as Partial<AdTemplate>));
  }

  findAll(tenantId?: string): Promise<AdTemplate[]> {
    const where = tenantId ? { tenantId } : {};
    return this.repo.find({ where, order: { updatedAt: 'DESC' } });
  }

  async findOne(id: string): Promise<AdTemplate> {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException(`AdTemplate ${id} not found`);
    return t;
  }

  async update(id: string, dto: UpdateAdTemplateDto): Promise<AdTemplate> {
    const t = await this.findOne(id);
    Object.assign(t, dto);
    return this.repo.save(t);
  }

  async remove(id: string): Promise<void> {
    const t = await this.findOne(id);
    await this.repo.remove(t);
  }

  /** 直接用平台 DB 配置调 AI，不经过 AiAgentService 的复杂路由 */
  private async callPlatformAi(system: string, user: string, maxTokens = 3000): Promise<string> {
    const cfg = await this.platformConfig.getDefaultProvider();
    if (!cfg?.apiKey) {
      throw new ServiceUnavailableException(
        '平台 AI Key 未配置。请前往 设置 → AI 配置 → 平台 AI Providers 添加一条记录并设为默认。',
      );
    }

    const providerId = isAiProviderId(cfg.provider) ? cfg.provider : 'openai';
    const providerDef = AI_PROVIDERS[providerId];
    const baseUrl = cfg.baseUrl || providerDef.baseUrl;
    const model = cfg.model || providerDef.defaultModel;

    this.logger.log(`generateVariants using provider=${providerId} model=${model}`);

    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: baseUrl });
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.9,
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  /**
   * 用平台 AI key 生成 10 条变体，写入 template.variants。
   * Prompt 模板从 platform_settings 读取，未设置时用内置默认。
   * 占位符：{content} = 原文，{count} = 条数
   */
  async generateVariants(id: string, count = 10): Promise<AdTemplate> {
    const t = await this.findOne(id);

    // 从数据库取 prompt 模板（admin 可配置）
    const promptTemplate = await this.platformConfig.getVariantPrompt();
    const prompt = promptTemplate
      .replace(/\{content\}/g, t.content)
      .replace(/\{count\}/g, String(count));

    const raw = await this.callPlatformAi(
      '你是广告文案生成助手。只输出纯 JSON 数组，格式：["变体1", "变体2", ...]，不输出任何其他内容。',
      prompt,
      4000,
    );

    let rawVariants: string[] = [];
    try {
      // 找到第一个 [ 到最后一个 ] 提取 JSON
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start !== -1 && end > start) {
        const jsonStr = raw.slice(start, end + 1);
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          rawVariants = parsed
            .map((v: any) => {
              // 有些模型输出字面量 \n 而非真换行，统一转换
              const text = String(v)
                .replace(/\\n/g, '\n')
                .trim();
              return text;
            })
            .filter(v => v.length > 10);
        }
      }
    } catch {
      // JSON 解析失败，回退到换行拆分
      rawVariants = raw
        .split(/\n{2,}/)
        .map(v => v.trim())
        .filter(v => v.length > 20 && !v.startsWith('[') && !v.startsWith('"'));
    }

    if (!rawVariants.length) {
      throw new ServiceUnavailableException('AI 返回格式异常，请重试');
    }

    t.variants = rawVariants.slice(0, count).map(text => ({ text }));
    t.aiVariantEnabled = true;
    this.logger.log(`Generated ${t.variants.length} variants for AdTemplate ${id}`);
    return this.repo.save(t);
  }
}
