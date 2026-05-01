import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { Account } from '../accounts/account.entity';
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { Task, TaskStatus, TaskType } from './task.entity';

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** 在第 dayOffset 天的 startHour 至 endHour 之间随机一个时点 (Gaussian-ish, 偏中位) */
function randomDayTime(base: Date, dayOffset: number, startHour: number, endHour: number): Date {
  const day = addDays(base, dayOffset);
  day.setHours(startHour, 0, 0, 0);
  const spanMs = (endHour - startHour) * 60 * 60 * 1000;
  // Box-Muller 近似, 让时间往窗口中点靠拢
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  let g = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * 0.25 + 0.5;
  g = Math.max(0.05, Math.min(0.95, g));
  return new Date(day.getTime() + spanMs * g);
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
  ) {}

  async create(dto: CreateTaskDto, tenantId?: string): Promise<Task> {
    let payload = dto.payload as any;
    // chat_script_ab/4p: 注入 A/B/C/D 手机号
    if (
      (dto.type === TaskType.CHAT_SCRIPT_AB || dto.type === TaskType.CHAT_SCRIPT_4P) &&
      payload?.accountAId
    ) {
      payload = await this.enrichChatScriptPayload(payload);
    }
    // media_*/post_channel/campaign_single: 接收方=内池号 → 查 phoneNumber 注入
    if (payload?.targetAccountId) {
      payload = await this.enrichOwnAccountTarget(payload);
    }
    // PRESET_* 组合配套: 不是单点执行, 展开成多日子任务
    if (
      dto.type === TaskType.PRESET_WARMUP_7D ||
      dto.type === TaskType.PRESET_RAMPUP_7D ||
      dto.type === TaskType.PRESET_FULL_14D ||
      dto.type === TaskType.PRESET_MATURE_OPS
    ) {
      return this.expandPreset(dto, tenantId);
    }

    const task = this.repo.create({
      ...dto,
      payload,
      scheduledAt: new Date(dto.scheduledAt),
      tenantId: tenantId ?? null,
      status: TaskStatus.PENDING,
      progress: 0,
    });
    return this.repo.save(task);
  }

  // ─── PRESET orchestrator ───────────────────────────────────────────
  /**
   * 把 preset_* 组合任务展开为 N 个真正能执行的子任务.
   * 父任务标 done + errorMsg='已展开为 N 个子任务' (作为历史记录),
   * 子任务在调度页正常列出, agent 按 scheduledAt 逐个领取.
   */
  private async expandPreset(dto: CreateTaskDto, tenantId?: string): Promise<Task> {
    const start = new Date(dto.scheduledAt);
    const baseName = dto.name;

    let subs: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];

    if (dto.type === TaskType.PRESET_WARMUP_7D) {
      subs = this.buildWarmup7d(start, baseName);
    } else if (dto.type === TaskType.PRESET_RAMPUP_7D) {
      subs = this.buildRampup7d(start, baseName);
    } else if (dto.type === TaskType.PRESET_FULL_14D) {
      subs = [
        ...this.buildWarmup7d(start, baseName + ' · 阶段 1'),
        ...this.buildRampup7d(addDays(start, 7), baseName + ' · 阶段 2'),
      ];
    } else if (dto.type === TaskType.PRESET_MATURE_OPS) {
      subs = this.buildMatureOps7d(start, baseName);
    }

    // 先创建父任务 (待运行状态作为"主任务"展示, 子任务进度反推父任务进度)
    const parent = await this.repo.save(this.repo.create({
      ...dto,
      scheduledAt: start,
      tenantId: tenantId ?? null,
      status: TaskStatus.PENDING,
      progress: 0,
    }));

    // 再创建子任务 + 链接 parentTaskId
    let savedCount = 0;
    for (const s of subs) {
      const sub = this.repo.create({
        name: s.name,
        type: s.type,
        accountId: dto.accountId ?? '',
        accountLabel: dto.accountLabel ?? null,
        payload: s.payload,
        scheduledAt: s.scheduledAt,
        tenantId: tenantId ?? null,
        parentTaskId: parent.id,
        status: TaskStatus.PENDING,
        progress: 0,
      });
      await this.repo.save(sub);
      savedCount++;
    }
    return parent;
  }

  /** 7 天养号: P0→P4 渐进, 每天 2-4 个低风险任务 */
  private buildWarmup7d(start: Date, baseName: string): Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> {
    const out: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];
    // Day 1 (P0): 仅保活, 不发任何外部信号
    out.push({
      type: TaskType.IDLE_KEEPALIVE,
      scheduledAt: randomDayTime(start, 0, 10, 22),
      name: `${baseName} · D1 · 保活`,
      payload: {},
    });
    // Day 2-3 (P1-P2): 浏览 + reaction (无副作用的"消费内容")
    for (let day = 1; day <= 2; day++) {
      out.push({
        type: TaskType.IDLE_KEEPALIVE,
        scheduledAt: randomDayTime(start, day, 10, 14),
        name: `${baseName} · D${day + 1} · 早间保活`,
        payload: {},
      });
      out.push({
        type: TaskType.IDLE_KEEPALIVE,
        scheduledAt: randomDayTime(start, day, 18, 22),
        name: `${baseName} · D${day + 1} · 晚间保活`,
        payload: {},
      });
    }
    // Day 4-5 (P3): 加入公开频道 (需要 payload.channels) — 这里仅出 keepalive,
    //   有 channels 时才下发 join_channels (实际配置时租户可加 payload.channels 字段)
    for (let day = 3; day <= 4; day++) {
      out.push({
        type: TaskType.IDLE_KEEPALIVE,
        scheduledAt: randomDayTime(start, day, 9, 12),
        name: `${baseName} · D${day + 1} · 早`,
        payload: {},
      });
      out.push({
        type: TaskType.IDLE_KEEPALIVE,
        scheduledAt: randomDayTime(start, day, 15, 18),
        name: `${baseName} · D${day + 1} · 午`,
        payload: {},
      });
      out.push({
        type: TaskType.IDLE_KEEPALIVE,
        scheduledAt: randomDayTime(start, day, 20, 23),
        name: `${baseName} · D${day + 1} · 晚`,
        payload: {},
      });
    }
    // Day 6-7 (P4): 加入更多保活 + profile_update (Day 7)
    for (let day = 5; day <= 6; day++) {
      out.push({
        type: TaskType.IDLE_KEEPALIVE,
        scheduledAt: randomDayTime(start, day, 10, 13),
        name: `${baseName} · D${day + 1} · 早`,
        payload: {},
      });
      out.push({
        type: TaskType.IDLE_KEEPALIVE,
        scheduledAt: randomDayTime(start, day, 19, 22),
        name: `${baseName} · D${day + 1} · 晚`,
        payload: {},
      });
    }
    return out;
  }

  /** 7 天热身: 加入更多互动 — 仍保守, 主体也是 keepalive 节奏 */
  private buildRampup7d(start: Date, baseName: string): Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> {
    const out: Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> = [];
    for (let day = 0; day < 7; day++) {
      // 每日 3-4 个 keepalive 信号
      out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, day, 8, 11), name: `${baseName} · D${day + 1} · 早`, payload: {} });
      out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, day, 12, 14), name: `${baseName} · D${day + 1} · 午`, payload: {} });
      out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, day, 15, 18), name: `${baseName} · D${day + 1} · 下午`, payload: {} });
      out.push({ type: TaskType.IDLE_KEEPALIVE, scheduledAt: randomDayTime(start, day, 20, 23), name: `${baseName} · D${day + 1} · 晚`, payload: {} });
    }
    return out;
  }

  /** Day 15+ 持续运营: 与 rampup 类似, 但仅展开 7 天作为一周配方, 用户可重复运行 */
  private buildMatureOps7d(start: Date, baseName: string): Array<{ type: TaskType; scheduledAt: Date; name: string; payload: any }> {
    return this.buildRampup7d(start, baseName);
  }

  /** 接收方是本租户内池号: 查手机号注入 targetId 给 executor 用 */
  private async enrichOwnAccountTarget(p: any): Promise<any> {
    if (!p.targetAccountId) return p;
    const acc = await this.accountRepo.findOneBy({ id: p.targetAccountId });
    if (!acc?.phoneNumber) return p;
    return { ...p, targetId: p.targetId ?? acc.phoneNumber };
  }

  /** 私聊模式注入各角色 phoneNumber 到 payload, 让 agent executor getEntity 用 */
  private async enrichChatScriptPayload(p: any): Promise<any> {
    const isPrivate = (p.chatMode ?? 'private') === 'private';
    if (!isPrivate) return p;
    const ids = [p.accountAId, p.accountBId, p.accountCId, p.accountDId].filter(Boolean) as string[];
    if (!ids.length) return p;
    const rows = await this.accountRepo.findBy({ id: In(ids) as any });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const phoneOf = (id?: string) => (id ? byId.get(id)?.phoneNumber : undefined);
    return {
      ...p,
      accountAPhone: phoneOf(p.accountAId),
      accountBPhone: phoneOf(p.accountBId),
      accountCPhone: phoneOf(p.accountCId),
      accountDPhone: phoneOf(p.accountDId),
    };
  }

  findAll(filters: { status?: TaskStatus; type?: TaskType; tenantId?: string } = {}): Promise<Task[]> {
    const where: FindOptionsWhere<Task> = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    // 默认隐藏 PRESET 子任务 (parentTaskId 不为空), 只列父任务
    const qb = this.repo.createQueryBuilder('t')
      .where(filters.status ? 't.status = :status' : '1=1', { status: filters.status })
      .andWhere(filters.type ? 't.type = :type' : '1=1', { type: filters.type })
      .andWhere(filters.tenantId ? 't.tenantId = :tid' : '1=1', { tid: filters.tenantId })
      .andWhere('t.parentTaskId IS NULL')
      .orderBy('t.createdAt', 'DESC')
      .limit(500);
    return qb.getMany();
  }

  /** 列出某个父任务下的所有子任务 (preset_* 展开后用) */
  async findChildren(parentTaskId: string): Promise<Task[]> {
    return this.repo.find({
      where: { parentTaskId },
      order: { scheduledAt: 'ASC' },
    });
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

  /**
   * 强制停止任务。无论当前状态都标记 FAILED + errorMsg='Cancelled by user'。
   * - pending：还没被 agent 领，DB 改完就生效
   * - running：agent 仍在跑当前 turn（Node 无法 kill 中途 await），但任务对用户视为已停。
   *   agent 完成当前 turn 后 PATCH 回 done 也会被 cancel 状态覆盖
   * - paused：直接 cancel
   * 已 done 的任务忽略 (cancel 历史已完成的没意义)
   */
  async cancel(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status === TaskStatus.DONE || t.status === TaskStatus.FAILED) return t;
    t.status = TaskStatus.FAILED;
    t.errorMsg = 'Cancelled by user';
    t.finishedAt = new Date();
    return this.repo.save(t);
  }

  /**
   * 紧急按钮：批量取消所有 pending/running/paused 任务。
   * 一次 UPDATE 完成，agent 下次 dispatch 不再领取这些。
   */
  async cancelAll(tenantId?: string): Promise<{ cancelled: number }> {
    const qb = this.repo
      .createQueryBuilder()
      .update(Task)
      .set({ status: TaskStatus.FAILED, errorMsg: 'Cancelled (bulk stop)', finishedAt: new Date() })
      .where('status IN (:...statuses)', {
        statuses: [TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.PAUSED],
      });
    if (tenantId) qb.andWhere('"tenantId" = :tid', { tid: tenantId });
    const res = await qb.execute();
    return { cancelled: res.affected ?? 0 };
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
