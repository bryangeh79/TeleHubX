import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { Task, TaskStatus, TaskType } from './task.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
  ) {}

  async create(dto: CreateTaskDto, tenantId?: string): Promise<Task | Task[]> {
    // chat_script_ab / chat_script_4p 多账号编排：
    // 当 payload 里有 accountAId/accountBId(/C/D) 时拆成 N 个子任务，
    // 每个子任务跑自己 myRole 的 turns。共享 packId/scriptId 和 tgChatId。
    if (
      (dto.type === TaskType.CHAT_SCRIPT_AB || dto.type === TaskType.CHAT_SCRIPT_4P)
      && dto.payload
      && (dto.payload as any).accountAId
    ) {
      return this.splitChatScriptTask(dto, tenantId);
    }

    const task = this.repo.create({
      ...dto,
      scheduledAt: new Date(dto.scheduledAt),
      tenantId: tenantId ?? null,
      status: TaskStatus.PENDING,
      progress: 0,
    });
    return this.repo.save(task);
  }

  private async splitChatScriptTask(dto: CreateTaskDto, tenantId?: string): Promise<Task[]> {
    const p = dto.payload as any;
    const isAB = dto.type === TaskType.CHAT_SCRIPT_AB;
    const roleAccounts: Array<{ role: 'A' | 'B' | 'C' | 'D'; accountId: string }> = [];
    if (p.accountAId) roleAccounts.push({ role: 'A', accountId: p.accountAId });
    if (p.accountBId) roleAccounts.push({ role: 'B', accountId: p.accountBId });
    if (!isAB) {
      if (p.accountCId) roleAccounts.push({ role: 'C', accountId: p.accountCId });
      if (p.accountDId) roleAccounts.push({ role: 'D', accountId: p.accountDId });
    }
    if (roleAccounts.length < 2) {
      throw new Error('chat_script 任务至少需要 2 个账号 (accountAId + accountBId)');
    }

    const baseScheduledAt = new Date(dto.scheduledAt);
    const created: Task[] = [];
    for (const ra of roleAccounts) {
      const subPayload = {
        ...p,
        myRole: ra.role,
        // 保留全部 accountIds 给执行器调试看
      };
      const sub = this.repo.create({
        name: `${dto.name} [${ra.role}]`,
        type: dto.type,
        accountId: ra.accountId,
        accountLabel: dto.accountLabel ?? null,
        payload: subPayload,
        scheduledAt: baseScheduledAt,
        tenantId: tenantId ?? null,
        status: TaskStatus.PENDING,
        progress: 0,
      });
      created.push(await this.repo.save(sub));
    }
    return created;
  }

  findAll(filters: { status?: TaskStatus; type?: TaskType; tenantId?: string } = {}): Promise<Task[]> {
    const where: FindOptionsWhere<Task> = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    return this.repo.find({ where, order: { scheduledAt: 'ASC' }, take: 500 });
  }

  async findOne(id: string): Promise<Task> {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException(`Task ${id} not found`);
    return t;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const t = await this.findOne(id);
    if (dto.scheduledAt) {
      t.scheduledAt = new Date(dto.scheduledAt);
    }
    if (dto.name !== undefined) t.name = dto.name;
    if (dto.status !== undefined) t.status = dto.status;
    if (dto.payload !== undefined) t.payload = dto.payload;
    if (dto.progress !== undefined) t.progress = dto.progress;
    if (dto.errorMsg !== undefined) t.errorMsg = dto.errorMsg;
    return this.repo.save(t);
  }

  async pause(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.RUNNING) return t;
    t.status = TaskStatus.PAUSED;
    return this.repo.save(t);
  }

  async resume(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.PAUSED) return t;
    t.status = TaskStatus.RUNNING;
    return this.repo.save(t);
  }

  async retry(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.FAILED) return t;
    t.status = TaskStatus.PENDING;
    t.errorMsg = null;
    t.progress = 0;
    t.startedAt = null;
    t.finishedAt = null;
    return this.repo.save(t);
  }

  /**
   * 复用：基于现有任务 clone 一个新任务并立即执行。
   * 不影响原任务，原任务保留作为历史。
   */
  async cloneAndRunNow(id: string): Promise<Task> {
    const orig = await this.findOne(id);
    const clone = this.repo.create({
      tenantId: orig.tenantId,
      name: orig.name,
      type: orig.type,
      accountId: orig.accountId,
      accountLabel: orig.accountLabel,
      payload: orig.payload,
      scheduledAt: new Date(),
      status: TaskStatus.PENDING,
      progress: 0,
    });
    return this.repo.save(clone);
  }

  async remove(id: string): Promise<void> {
    const t = await this.findOne(id);
    await this.repo.remove(t);
  }

  async stats(tenantId?: string): Promise<{ total: number; pending: number; running: number; failed: number; done: number }> {
    const where: FindOptionsWhere<Task> = {};
    if (tenantId) where.tenantId = tenantId;
    const all = await this.repo.find({ where, take: 5000 });
    return {
      total:   all.length,
      pending: all.filter((t) => t.status === TaskStatus.PENDING).length,
      running: all.filter((t) => t.status === TaskStatus.RUNNING).length,
      failed:  all.filter((t) => t.status === TaskStatus.FAILED).length,
      done:    all.filter((t) => t.status === TaskStatus.DONE).length,
    };
  }

  /**
   * Agent 调用：原子地领取一批可执行任务（pending + scheduledAt<=now + 限定 accountId）。
   * 领取的任务立即 status=running 并设 startedAt，避免多 agent 重复执行。
   *
   * 客户端约束：
   *   - 只领自己负责的账号的任务（accountIds 列表）
   *   - 一次最多 limit 个（默认 5），避免单 agent 抢光
   *   - 每个 task 用 typeORM 乐观锁防 race
   */
  async dispatchToAgent(accountIds: string[], limit = 5): Promise<Task[]> {
    if (!accountIds.length) return [];
    const now = new Date();
    const candidates = await this.repo
      .createQueryBuilder('t')
      .where('t.status = :s', { s: TaskStatus.PENDING })
      .andWhere('t."scheduledAt" <= :now', { now })
      .andWhere('t."accountId" IN (:...ids)', { ids: accountIds })
      .orderBy('t."scheduledAt"', 'ASC')
      .limit(limit)
      .getMany();

    if (!candidates.length) return [];

    // 原子转 running
    const ids = candidates.map((c) => c.id);
    const updateRes = await this.repo
      .createQueryBuilder()
      .update(Task)
      .set({ status: TaskStatus.RUNNING, startedAt: now })
      .where('id IN (:...ids)', { ids })
      .andWhere('status = :s', { s: TaskStatus.PENDING })
      .returning('*')
      .execute();

    return (updateRes.raw as Task[]) ?? [];
  }
}
