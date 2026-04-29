import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Lead, LeadIntent, LeadStatus } from './lead.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { AssignLeadDto } from './dto/assign-lead.dto';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly repo: Repository<Lead>,
  ) {}

  create(dto: CreateLeadDto): Promise<Lead> {
    const lead = this.repo.create(dto as Partial<Lead>);
    return this.repo.save(lead);
  }

  findAll(filters: { status?: LeadStatus; intent?: LeadIntent; needsHuman?: boolean }): Promise<Lead[]> {
    const where: FindOptionsWhere<Lead> = {};
    if (filters.status) where.status = filters.status;
    if (filters.intent) where.intent = filters.intent;
    if (filters.needsHuman !== undefined) where.needsHuman = filters.needsHuman;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Lead> {
    const lead = await this.repo.findOneBy({ id });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  async assign(id: string, dto: AssignLeadDto): Promise<Lead> {
    const lead = await this.findOne(id);
    lead.assignedCsAccountId = dto.csAccountId;
    lead.status = LeadStatus.ASSIGNED;
    return this.repo.save(lead);
  }

  async updateIntent(id: string, intent: LeadIntent): Promise<Lead> {
    const lead = await this.findOne(id);
    lead.intent = intent;
    return this.repo.save(lead);
  }

  async addNote(id: string, note: string): Promise<Lead> {
    const lead = await this.findOne(id);
    lead.notes = [...(lead.notes || []), note];
    return this.repo.save(lead);
  }

  async remove(id: string): Promise<void> {
    const lead = await this.findOne(id);
    await this.repo.remove(lead);
  }
}
