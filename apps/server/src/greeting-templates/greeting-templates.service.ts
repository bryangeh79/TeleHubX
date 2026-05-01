import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GreetingTemplate } from './greeting-template.entity';
import { CreateGreetingTemplateDto } from './dto/create-greeting-template.dto';
import { UpdateGreetingTemplateDto } from './dto/update-greeting-template.dto';

@Injectable()
export class GreetingTemplatesService {
  constructor(
    @InjectRepository(GreetingTemplate)
    private readonly repo: Repository<GreetingTemplate>,
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
}
