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
   * 变体要求：句式/表情/标点/格式 微差异，相似度 < 70%，语言与原文一致。
   */
  async generateVariants(id: string, count = 10): Promise<AdTemplate> {
    const t = await this.findOne(id);

    const prompt = `你是一个专业的广告文案优化师。
原始广告文案如下：
---
${t.content}
---
请生成 ${count} 条变体版本，要求：
1. 保持核心卖点不变，但在句式、emoji 使用、标点符号、段落格式上做出明显差异
2. 每条变体与原文相似度 < 70%（系统会检测重复内容）
3. 语言风格与原文保持一致（中文/英文/马来文等）
4. 每条变体独立成章，不要编号前缀，不要解释说明
5. 用 |||SPLIT||| 分隔每条变体

直接输出变体内容，不要其他文字：`;

    const raw = await this.callPlatformAi(
      '你是广告文案生成助手，只输出变体内容，用 |||SPLIT||| 分隔，不输出任何解释。',
      prompt,
    );

    const rawVariants = raw
      .split('|||SPLIT|||')
      .map(v => v.trim())
      .filter(v => v.length > 10);

    t.variants = rawVariants.slice(0, count).map(text => ({ text }));
    t.aiVariantEnabled = true;
    return this.repo.save(t);
  }
}
