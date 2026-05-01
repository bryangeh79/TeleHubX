import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { GreetingTemplate } from './greeting-template.entity';
import { CreateGreetingTemplateDto } from './dto/create-greeting-template.dto';
import { UpdateGreetingTemplateDto } from './dto/update-greeting-template.dto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';

/** 6 类默认开场白样本（每类 3 条），新租户一键导入 */
const DEFAULT_SAMPLES: Array<{ category: string; text: string }> = [
  // 礼貌
  { category: '礼貌', text: '你好，打扰您一下 👋' },
  { category: '礼貌', text: '您好，请问方便聊几句吗？' },
  { category: '礼貌', text: 'Hi～不好意思打扰下' },
  // 好奇
  { category: '好奇', text: '想问下您对这类产品有兴趣吗？' },
  { category: '好奇', text: '不知道您有没有遇到过这个问题' },
  { category: '好奇', text: '看到您应该是行业内的，想请教一下' },
  // 优惠
  { category: '优惠', text: '这个月有特别优惠想跟您分享 💰' },
  { category: '优惠', text: '限时活动，错过就没有了' },
  { category: '优惠', text: '第一次接触我们的话有惊喜价' },
  // 热情
  { category: '热情', text: 'Hi！很高兴认识您 🤝' },
  { category: '热情', text: '您好呀！欢迎了解我们～' },
  { category: '热情', text: '嗨～终于联系上您了 😊' },
  // 专业
  { category: '专业', text: '关于您之前关注的话题，有些专业建议想分享' },
  { category: '专业', text: '我是专业团队，可以为您提供咨询' },
  { category: '专业', text: '根据您的情况，有几个方案建议可以参考' },
  // 幽默
  { category: '幽默', text: '我是真人不是机器人 🤖🚫' },
  { category: '幽默', text: '听说您可能需要这个？我猜对了吗 😄' },
  { category: '幽默', text: '不是广告，是好东西 ✨' },
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
