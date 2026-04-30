import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Lead, LeadIntent, LeadReply, LeadStatus, LeadTakeover } from './lead.entity';
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

  async reply(id: string, text: string): Promise<Lead> {
    const lead = await this.findOne(id);
    const entry: LeadReply = {
      text,
      sentBy: 'human',
      ts: new Date().toISOString(),
    };
    lead.replies = [...(lead.replies || []), entry];
    if (lead.status !== LeadStatus.CONVERTED && lead.status !== LeadStatus.CLOSED) {
      lead.status = LeadStatus.IN_PROGRESS;
    }
    return this.repo.save(lead);
  }

  async takeOver(id: string, operator?: string): Promise<Lead> {
    const lead = await this.findOne(id);
    lead.takeoverState = LeadTakeover.HUMAN;
    lead.takenOverBy = operator ?? 'operator';
    lead.takenOverAt = new Date();
    if (lead.status === LeadStatus.NEW) lead.status = LeadStatus.IN_PROGRESS;
    return this.repo.save(lead);
  }

  async release(id: string): Promise<Lead> {
    const lead = await this.findOne(id);
    lead.takeoverState = LeadTakeover.AI;
    lead.takenOverBy = '';
    lead.takenOverAt = null;
    return this.repo.save(lead);
  }

  async setTakeoverState(id: string, state: LeadTakeover): Promise<Lead> {
    const lead = await this.findOne(id);
    lead.takeoverState = state;
    if (state === LeadTakeover.AI) {
      lead.takenOverBy = '';
      lead.takenOverAt = null;
    }
    return this.repo.save(lead);
  }

  async remove(id: string): Promise<void> {
    const lead = await this.findOne(id);
    await this.repo.remove(lead);
  }

  async findOrCreateByTgChatId(
    tgUserId: string,
    tenantId: string,
    tgUsername?: string,
  ): Promise<Lead> {
    let lead = await this.repo.findOneBy({ tgUserId, tenantId });
    if (!lead) {
      lead = this.repo.create({ tgUserId, tenantId, tgUsername });
      lead = await this.repo.save(lead);
    } else if (tgUsername && lead.tgUsername !== tgUsername) {
      lead.tgUsername = tgUsername;
      lead = await this.repo.save(lead);
    }
    return lead;
  }

  async addReply(id: string, entry: { sender: 'user' | 'system'; text: string }): Promise<Lead> {
    const lead = await this.findOne(id);
    const item: LeadReply = { text: entry.text, sentBy: entry.sender, ts: new Date().toISOString() };
    lead.replies = [...(lead.replies || []), item];
    return this.repo.save(lead);
  }
}
