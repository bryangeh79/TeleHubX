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

    const prompt = `你是专业广告文案优化师。
原始文案：
---
${t.content}
---
请生成 ${count} 条变体，要求：
1. 保持核心卖点不变，在句式、emoji、标点上有明显差异
2. 每条与原文相似度 < 70%
3. 语言与原文一致（中文/英文/马来文）
4. 保留原文所有联系方式（链接/电话/账号）完全不改
5. 不加编号或前缀
6. 【重要】严格保留原文的段落结构和换行格式：原文有几个段落，变体也要有几个段落；列表项（✅ 开头的行）每条单独一行，不得合并成一段
7. JSON 字符串内用 \\n 表示换行，段落之间用 \\n\\n 分隔

以 JSON 数组格式输出，只输出纯 JSON，不要任何解释或 markdown：
["变体1内容", "变体2内容", ..., "变体${count}内容"]`;

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
