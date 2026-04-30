import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Account } from '../accounts/account.entity';
import { Task, TaskStatus, TaskType } from '../tasks/task.entity';
import { ExecutionGroup, MAX_MEMBERS_PER_GROUP } from './execution-group.entity';
import { AssignMembersDto, UpdateGroupDto } from './execution-group.dto';

export interface GroupWithMembers extends ExecutionGroup {
  members: Account[];
}

@Injectable()
export class ExecutionGroupsService {
  private readonly logger = new Logger(ExecutionGroupsService.name);

  constructor(
    @InjectRepository(ExecutionGroup) private readonly groups: Repository<ExecutionGroup>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
  ) {}

  async listWithMembers(tenantId?: string): Promise<GroupWithMembers[]> {
    const where = tenantId ? { tenantId } : {};
    const groups = await this.groups.find({ where, order: { slotNum: 'ASC' } });
    if (!groups.length) return [];
    const ids = groups.map((g) => g.id);
    const members = await this.accounts.find({ where: { executionGroupId: In(ids) } });
    return groups.map((g) => ({
      ...g,
      members: members.filter((m) => m.executionGroupId === g.id),
    }));
  }

  async listUngrouped(tenantId?: string): Promise<Account[]> {
    return this.accounts.find({
      where: { executionGroupId: IsNull(), ...(tenantId ? {} : {}) },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string): Promise<ExecutionGroup> {
    const g = await this.groups.findOneBy({ id });
    if (!g) throw new NotFoundException(`Group ${id} not found`);
    return g;
  }

  async update(id: string, dto: UpdateGroupDto): Promise<ExecutionGroup> {
    const g = await this.findOne(id);
    if (dto.name !== undefined) g.name = dto.name;
    if (dto.notes !== undefined) g.notes = dto.notes;
    return this.groups.save(g);
  }

  /**
   * Replace the member list of a group (idempotent).
   * Throws if accountIds.length > 6 or if any account already belongs to a different group.
   */
  async assignMembers(id: string, dto: AssignMembersDto): Promise<GroupWithMembers> {
    const g = await this.findOne(id);
    const ids = Array.from(new Set(dto.accountIds));
    if (ids.length > MAX_MEMBERS_PER_GROUP) {
      throw new BadRequestException(`一组最多 ${MAX_MEMBERS_PER_GROUP} 个账号`);
    }

    // Validate accounts exist and aren't owned by another group
    if (ids.length) {
      const found = await this.accounts.find({ where: { id: In(ids) } });
      if (found.length !== ids.length) {
        throw new NotFoundException('部分 accountId 不存在');
      }
      for (const a of found) {
        if (a.executionGroupId && a.executionGroupId !== id) {
          throw new BadRequestException(
            `账号 ${a.phoneNumber} 已属于其他组，请先从原组移除`,
          );
        }
      }
    }

    // Clear existing members not in new set
    await this.accounts.update({ executionGroupId: id }, { executionGroupId: null });
    if (ids.length) {
      await this.accounts.update({ id: In(ids) }, { executionGroupId: id });
    }

    return this.fetchWithMembers(id);
  }

  /** Move/remove a single account. groupId=null removes from any group. */
  async assignSingleAccount(accountId: string, groupId: string | null): Promise<Account> {
    const a = await this.accounts.findOneBy({ id: accountId });
    if (!a) throw new NotFoundException(`Account ${accountId} not found`);

    if (groupId) {
      const g = await this.findOne(groupId);
      const count = await this.accounts.count({ where: { executionGroupId: g.id } });
      const alreadyHere = a.executionGroupId === g.id;
      if (!alreadyHere && count >= MAX_MEMBERS_PER_GROUP) {
        throw new BadRequestException(`组 ${g.slotNum} 已满（${MAX_MEMBERS_PER_GROUP}/${MAX_MEMBERS_PER_GROUP}）`);
      }
      a.executionGroupId = g.id;
    } else {
      a.executionGroupId = null;
    }
    return this.accounts.save(a);
  }

  /**
   * Reconcile groups to a target count (2..9) for the tenant.
   * - If we need more groups → create new ones (slotNum incrementing)
   * - If we need fewer → remove the highest slotNum groups, unassigning their members
   * - count=0 disables: keeps existing groups but no new auto-scheduling
   */
  async reconcileCount(targetCount: number, tenantId?: string): Promise<{ created: number; removed: number; total: number }> {
    if (targetCount < 0 || targetCount > 9) {
      throw new BadRequestException('groupCount 必须在 0-9 之间');
    }
    if (targetCount > 0 && targetCount < 2) {
      throw new BadRequestException('启用组别时数量必须 >= 2');
    }

    const where = tenantId ? { tenantId } : {};
    const existing = await this.groups.find({ where, order: { slotNum: 'ASC' } });
    let created = 0;
    let removed = 0;

    if (existing.length < targetCount) {
      // Create missing
      for (let n = existing.length + 1; n <= targetCount; n++) {
        const g = this.groups.create({ tenantId: tenantId ?? null, slotNum: n, name: `组 ${n}` });
        await this.groups.save(g);
        created++;
      }
    } else if (existing.length > targetCount) {
      // Remove highest slotNum first; unassign their members
      const toRemove = existing.slice(targetCount);
      for (const g of toRemove) {
        await this.accounts.update({ executionGroupId: g.id }, { executionGroupId: null });
        await this.groups.remove(g);
        removed++;
      }
    }

    return { created, removed, total: targetCount };
  }

  async fetchWithMembers(id: string): Promise<GroupWithMembers> {
    const g = await this.findOne(id);
    const members = await this.accounts.find({ where: { executionGroupId: id } });
    return { ...g, members };
  }

  /**
   * Schedule baseline `idle_keepalive` tasks staggered across groups.
   * Each group fires every 6 hours, staggered by (24h / groupCount) per group.
   * Only schedules a single 24h cycle as a starting baseline; worker (TBD) recreates daily.
   */
  async autoSchedule(tenantId: string | null): Promise<{ scheduled: number; groupCount: number }> {
    const where = tenantId ? { tenantId } : {};
    const groupsList = await this.groups.find({ where, order: { slotNum: 'ASC' } });
    if (groupsList.length < 2) return { scheduled: 0, groupCount: groupsList.length };

    const groupCount = groupsList.length;
    const offsetMs = (24 * 60 * 60 * 1000) / groupCount; // 等距偏移
    const now = Date.now();

    let scheduled = 0;
    for (const g of groupsList) {
      const members = await this.accounts.find({ where: { executionGroupId: g.id } });
      if (!members.length) continue;
      const groupStart = now + (g.slotNum - 1) * offsetMs;

      for (const member of members) {
        const t = this.tasks.create({
          tenantId: tenantId ?? null,
          name: `[组 ${g.slotNum}] keepalive · ${member.phoneNumber}`,
          type: TaskType.IDLE_KEEPALIVE,
          status: TaskStatus.PENDING,
          accountId: member.id,
          accountLabel: member.phoneNumber,
          payload: { groupSlotNum: g.slotNum, autoScheduled: true },
          scheduledAt: new Date(groupStart),
          progress: 0,
        });
        await this.tasks.save(t);
        scheduled++;
      }
    }
    this.logger.log(`autoSchedule: created ${scheduled} tasks across ${groupCount} groups`);
    return { scheduled, groupCount };
  }
}
