import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdTemplate } from './ad-template.entity';
import { CreateAdTemplateDto } from './dto/create-ad-template.dto';
import { UpdateAdTemplateDto } from './dto/update-ad-template.dto';

@Injectable()
export class AdTemplatesService {
  constructor(
    @InjectRepository(AdTemplate)
    private readonly repo: Repository<AdTemplate>,
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
}
