import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ensureTenant } from '../auth/tenant-guard.util';
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

  findAll(filters: { status?: LeadStatus; intent?: LeadIntent; needsHuman?: boolean; tenantId?: string | null }): Promise<Lead[]> {
    const where: FindOptionsWhere<Lead> = {};
    if (filters.status) where.status = filters.status;
    if (filters.intent) where.intent = filters.intent;
    if (filters.needsHuman !== undefined) where.needsHuman = filters.needsHuman;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  /** 内部：跳过租户校验。仅 BotGateway / agent / SUPER_ADMIN 用 */
  async findOne(id: string): Promise<Lead> {
    const lead = await this.repo.findOneBy({ id });
    if (!lead) throw new NotFoundException(`Lead ${id} not found`);
    return lead;
  }

  /** 租户权属保护版 */
  async findOneScoped(id: string, callerTenantId: string | null): Promise<Lead> {
    const lead = await this.repo.findOneBy({ id });
    return ensureTenant(lead, callerTenantId, 'Lead');
  }

  async assign(id: string, dto: AssignLeadDto, callerTenantId: string | null = null): Promise<Lead> {
    const lead = await this.findOneScoped(id, callerTenantId);
    lead.assignedCsAccountId = dto.csAccountId;
    lead.status = LeadStatus.ASSIGNED;
    return this.repo.save(lead);
  }

  async updateIntent(id: string, intent: LeadIntent, callerTenantId: string | null = null): Promise<Lead> {
    const lead = await this.findOneScoped(id, callerTenantId);
    lead.intent = intent;
    return this.repo.save(lead);
  }

  async addNote(id: string, note: string, callerTenantId: string | null = null): Promise<Lead> {
    const lead = await this.findOneScoped(id, callerTenantId);
    lead.notes = [...(lead.notes || []), note];
    return this.repo.save(lead);
  }

  async reply(id: string, text: string, callerTenantId: string | null = null): Promise<Lead> {
    const lead = await this.findOneScoped(id, callerTenantId);
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

  async takeOver(id: string, operator?: string, callerTenantId: string | null = null): Promise<Lead> {
    const lead = await this.findOneScoped(id, callerTenantId);
    lead.takeoverState = LeadTakeover.HUMAN;
    lead.takenOverBy = operator ?? 'operator';
    lead.takenOverAt = new Date();
    if (lead.status === LeadStatus.NEW) lead.status = LeadStatus.IN_PROGRESS;
    return this.repo.save(lead);
  }

  async release(id: string, callerTenantId: string | null = null): Promise<Lead> {
    const lead = await this.findOneScoped(id, callerTenantId);
    lead.takeoverState = LeadTakeover.AI;
    lead.takenOverBy = '';
    lead.takenOverAt = null;
    return this.repo.save(lead);
  }

  async setTakeoverState(id: string, state: LeadTakeover, callerTenantId: string | null = null): Promise<Lead> {
    const lead = await this.findOneScoped(id, callerTenantId);
    lead.takeoverState = state;
    if (state === LeadTakeover.AI) {
      lead.takenOverBy = '';
      lead.takenOverAt = null;
    }
    return this.repo.save(lead);
  }

  async remove(id: string, callerTenantId: string | null = null): Promise<void> {
    const lead = await this.findOneScoped(id, callerTenantId);
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

  async addReply(id: string, entry: { sender: 'user' | 'system' | 'human'; text: string }): Promise<Lead> {
    const lead = await this.findOne(id);
    const item: LeadReply = { text: entry.text, sentBy: entry.sender, ts: new Date().toISOString() };
    lead.replies = [...(lead.replies || []), item];
    return this.repo.save(lead);
  }

  /**
   * 仪表盘 KPI: 客户对话指标。
   * - botTodayMessageCount: 今日 Bot 自动回复条数（sender system/bot）
   * - userTodayMessageCount: 今日客户消息条数（sender user）
   * - humanTakeoverCount: takeoverState=human 的 lead 总数（待人工跟进）
   * - pendingCount: 最近 1h 客户发了消息但没收到 Bot 回复（rate limited / silent）
   */
  async dashboardStats(tenantId?: string): Promise<{
    botTodayMessageCount: number;
    userTodayMessageCount: number;
    humanTakeoverCount: number;
    pendingCount: number;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const oneHourAgoMs = Date.now() - 60 * 60_000;

    const where: FindOptionsWhere<Lead> = tenantId ? { tenantId } : {};
    const leads = await this.repo.find({ where });

    let botTodayMessageCount = 0;
    let userTodayMessageCount = 0;
    let humanTakeoverCount = 0;
    let pendingCount = 0;

    for (const lead of leads) {
      if (lead.takeoverState === LeadTakeover.HUMAN) humanTakeoverCount++;

      const replies = lead.replies ?? [];
      let hadUserAfterLastBot = false;
      let lastUserTs: number | null = null;
      for (const r of replies) {
        const ts = r.ts ? new Date(r.ts).getTime() : 0;
        if (ts >= todayMs) {
          if (r.sentBy === 'user') userTodayMessageCount++;
          else if (r.sentBy === 'system' || r.sentBy === 'human') botTodayMessageCount++;
        }
        if (r.sentBy === 'user') {
          lastUserTs = ts;
          hadUserAfterLastBot = true;
        } else if (r.sentBy === 'system' || r.sentBy === 'human') {
          hadUserAfterLastBot = false;
        }
      }
      // pending: 最后一条用户消息在最近 1h 内 + 后面没有 bot 回复 + 不是 HUMAN（human 走人工流程不算 pending）
      if (
        hadUserAfterLastBot &&
        lastUserTs !== null &&
        lastUserTs >= oneHourAgoMs &&
        lead.takeoverState !== LeadTakeover.HUMAN
      ) {
        pendingCount++;
      }
    }

    return { botTodayMessageCount, userTodayMessageCount, humanTakeoverCount, pendingCount };
  }
}
