import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { GreetingTemplate } from './greeting-template.entity';
import { CreateGreetingTemplateDto } from './dto/create-greeting-template.dto';
import { UpdateGreetingTemplateDto } from './dto/update-greeting-template.dto';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';

@Injectable()
export class GreetingTemplatesService {
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

  private async callPlatformAi(system: string, user: string, maxTokens = 20): Promise<string> {
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
      temperature: 0.1,
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  /** 用平台 AI key 给开场白打分 (1-10) */
  async scoreGreeting(id: string): Promise<GreetingTemplate> {
    const g = await this.findOne(id);
    const raw = await this.callPlatformAi(
      '你是营销文案质量评估专家。只返回一个 1-10 的整数评分，不要任何解释。',
      `评估以下开场白对陌生客户的吸引力和转化潜力（1=差，10=优秀）：\n\n"${g.text}"`,
    );
    const score = parseInt(raw.trim(), 10);
    if (!isNaN(score) && score >= 1 && score <= 10) {
      g.aiScore = score;
      return this.repo.save(g);
    }
    return g;
  }
}
