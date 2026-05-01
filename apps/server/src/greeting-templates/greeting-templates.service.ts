import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { GreetingTemplate } from './greeting-template.entity';
import { CreateGreetingTemplateDto } from './dto/create-greeting-template.dto';
import { UpdateGreetingTemplateDto } from './dto/update-greeting-template.dto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';

/**
 * 平台默认开场白样本 — 每个分类一条精选基础样本。
 * 租户拿到后可以再用 AI 生成 8 条变体扩展，避免开场白雷同被检测。
 */
const DEFAULT_SAMPLES: Array<{ category: string; text: string }> = [
  { category: '礼貌', text: '你好，打扰您一下 👋' },
  { category: '优惠', text: '您好，新客户可以先免费试用 7 天，不满意零成本退出。看要不要先体验一下？' },
  { category: '热情', text: '您好呀！今天天气真不错 ☀️ 想跟您分享个好东西，绝对不会让您失望' },
  { category: '专业', text: '您好，我们是 XX 平台的官方合作伙伴，专门做 XX 业务。看您应该用得上，简单介绍一下？' },
];

@Injectable()
export class GreetingTemplatesService {
  private readonly logger = new Logger(GreetingTemplatesService.name);

  constructor(
    @InjectRepository(GreetingTemplate)
    private readonly repo: Repository<GreetingTemplate>,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  create(dto: CreateGreetingTemplateDto): Promise<GreetingTemplate> {
    return this.repo.save(this.repo.create(dto as Partial<GreetingTemplate>));
  }

  findAll(tenantId?: string): Promise<GreetingTemplate[]> {
    const where = tenantId ? { tenantId } : {};
    return this.repo.find({ where, order: { aiScore: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<GreetingTemplate> {
    const g = await this.repo.findOneBy({ id });
    if (!g) throw new NotFoundException(`GreetingTemplate ${id} not found`);
    return g;
  }

  async update(id: string, dto: UpdateGreetingTemplateDto): Promise<GreetingTemplate> {
    const g = await this.findOne(id);
    Object.assign(g, dto);
    return this.repo.save(g);
  }

  async remove(id: string): Promise<void> {
    const g = await this.findOne(id);
    await this.repo.remove(g);
  }

  /** 一键导入 18 条默认样本 */
  async seedDefaults(tenantId: string): Promise<{ created: number; skipped: number }> {
    const existing = await this.repo.find({ where: { tenantId } });
    const existingTexts = new Set(existing.map(g => g.text));
    let created = 0;
    let skipped = 0;
    for (const sample of DEFAULT_SAMPLES) {
      if (existingTexts.has(sample.text)) {
        skipped++;
        continue;
      }
      const g = this.repo.create({ tenantId, ...sample });
      await this.repo.save(g);
      created++;
    }
    return { created, skipped };
  }

  private async callPlatformAi(system: string, user: string, maxTokens = 2000): Promise<string> {
    const cfg = await this.platformConfig.getDefaultProvider();
    if (!cfg?.apiKey) {
      throw new ServiceUnavailableException(
        '平台 AI Key 未配置。请前往 设置 → AI 配置 → 平台 AI Providers 添加一条记录并设为默认。',
      );
    }
    const providerId = isAiProviderId(cfg.provider) ? cfg.provider : 'openai';
    const providerDef = AI_PROVIDERS[providerId];
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl || providerDef.baseUrl,
    });
    const completion = await client.chat.completions.create({
      model: cfg.model || providerDef.defaultModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.85,
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  /** 用平台 AI key 给开场白打分 (1-10) */
  async scoreGreeting(id: string): Promise<GreetingTemplate> {
    const g = await this.findOne(id);
    const raw = await this.callPlatformAi(
      '你是营销文案质量评估专家。只返回一个 1-10 的整数评分，不要任何解释。',
      `评估以下开场白对陌生客户的吸引力和转化潜力（1=差，10=优秀）：\n\n"${g.text}"`,
      20,
    );
    const score = parseInt(raw.trim(), 10);
    if (!isNaN(score) && score >= 1 && score <= 10) {
      g.aiScore = score;
      return this.repo.save(g);
    }
    return g;
  }

  /** 生成 N 条开场白变体 */
  async generateVariants(id: string, count = 8): Promise<GreetingTemplate> {
    const g = await this.findOne(id);

    const prompt = `你是营销开场白优化师。
原始开场白：
---
${g.text}
---
${g.category ? `分类风格：${g.category}` : ''}

请生成 ${count} 条变体，要求：
1. 保持原始语气和分类风格
2. 简短自然，像真人开口聊天，不超过 30 字
3. 句式 / emoji / 标点 / 用词上有明显差异
4. 中文为主，可适当混搭 emoji

以 JSON 数组格式输出，只输出纯 JSON：
["变体1", "变体2", ..., "变体${count}"]`;

    const raw = await this.callPlatformAi(
      '你是开场白生成助手。只输出纯 JSON 数组，不输出任何其他内容。',
      prompt,
      1500,
    );

    let rawVariants: string[] = [];
    try {
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(parsed)) {
          rawVariants = parsed.map((v: any) => String(v).trim()).filter(v => v.length > 2);
        }
      }
    } catch {
      rawVariants = raw.split(/\n/).map(v => v.trim()).filter(v => v.length > 2 && !v.startsWith('[') && !v.startsWith('"'));
    }

    if (!rawVariants.length) {
      throw new ServiceUnavailableException('AI 返回格式异常，请重试');
    }

    g.variants = rawVariants.slice(0, count).map(text => ({ text }));
    g.aiVariantEnabled = true;
    this.logger.log(`Generated ${g.variants.length} variants for GreetingTemplate ${id}`);
    return this.repo.save(g);
  }
}
