import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GreetingTemplate } from './greeting-template.entity';
import { CreateGreetingTemplateDto } from './dto/create-greeting-template.dto';
import { UpdateGreetingTemplateDto } from './dto/update-greeting-template.dto';
import { AiAgentService } from '../ai-agent/ai-agent.service';

@Injectable()
export class GreetingTemplatesService {
  constructor(
    @InjectRepository(GreetingTemplate)
    private readonly repo: Repository<GreetingTemplate>,
    private readonly ai: AiAgentService,
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

  /** 用平台 AI key 给开场白打分 (1-10) */
  async scoreGreeting(id: string): Promise<GreetingTemplate> {
    const g = await this.findOne(id);
    const raw = await this.ai.complete({
      system: '你是营销文案质量评估专家。只返回一个 1-10 的整数评分，不要任何解释。',
      user: `评估以下开场白对陌生客户的吸引力和转化潜力（1=差，10=优秀）：\n\n"${g.text}"`,
      maxTokens: 5,
      temperature: 0.1,
    });
    const score = parseInt(raw.trim(), 10);
    if (!isNaN(score) && score >= 1 && score <= 10) {
      g.aiScore = score;
      return this.repo.save(g);
    }
    return g;
  }
}
