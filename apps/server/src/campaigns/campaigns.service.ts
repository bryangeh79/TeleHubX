import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import {
  Campaign,
  CampaignStatus,
  MATURE_DAYS,
  MATURE_MIN_HEALTH,
  PACE_LIMITS,
  PacePreset,
} from './campaign.entity';
import { Account, AccountRole } from '../accounts/account.entity';
import { ensureTenant } from '../auth/tenant-guard.util';
import { CustomerGroup } from '../customer-groups/customer-group.entity';
import { Task, TaskStatus } from '../tasks/task.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  constructor(
    @InjectRepository(Campaign)
    private readonly repo: Repository<Campaign>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(CustomerGroup)
    private readonly groupRepo: Repository<CustomerGroup>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
  ) {}

  /** 列出某 campaign 派发出来的所有子任务（用于日志查看）.
   *  Codex #1: callerTenantId 用于校验 campaign 归属 */
  async listTasks(campaignId: string, callerTenantId: string | null = null): Promise<{
    summary: { total: number; pending: number; running: number; done: number; failed: number; paused: number };
    tasks: Array<{
      id: string; seq: number | null; status: string;
      accountLabel: string | null; target: string | null;
      scheduledAt: Date; startedAt: Date | null; finishedAt: Date | null;
      errorMsg: string | null;
    }>;
  }> {
    // 校验 campaign 归属
    await this.findOneScoped(campaignId, callerTenantId);
    const tasks = await this.taskRepo
      .createQueryBuilder('t')
      .where(`t.payload->>'campaignId' = :id`, { id: campaignId })
      .orderBy('t.scheduledAt', 'ASC')
      .getMany();

    const summary = { total: tasks.length, pending: 0, running: 0, done: 0, failed: 0, paused: 0 };
    for (const t of tasks) {
      const s = t.status as string;
      if (s in summary) (summary as any)[s]++;
    }

    const items = tasks.map(t => {
      const targets = (t.payload?.targets as any[]) ?? [];
      const target = targets.length === 1
        ? (typeof targets[0] === 'string' ? targets[0] : targets[0]?.value ?? targets[0]?.username ?? null)
        : null;
      return {
        id: t.id,
        seq: t.seq,
        status: t.status,
        accountLabel: t.accountLabel,
        target,
        scheduledAt: t.scheduledAt,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        errorMsg: t.errorMsg,
      };
    });

    return { summary, tasks: items };
  }

  /**
   * 批量重试 campaign 内所有 failed 任务。
   * 状态 failed → pending，清错误信息，scheduledAt 设为 NOW，
   * agent 下轮 dispatch 自动重新执行。
   */
  async retryFailedTasks(campaignId: string, callerTenantId: string | null = null): Promise<{ retried: number }> {
    // Codex #1: tenant scope
    await this.findOneScoped(campaignId, callerTenantId);
    const res = await this.taskRepo
      .createQueryBuilder()
      .update(Task)
      .set({
        status: TaskStatus.PENDING,
        errorMsg: null,
        progress: 0,
        startedAt: null,
        finishedAt: null,
        cancelRequested: false,    // Codex #9: 与 TasksService.retryAllFailedOfCampaign 同步, 否则被取消的重试无效
        scheduledAt: () => 'NOW()',
      })
      .where('status = :s', { s: TaskStatus.FAILED })
      .andWhere(`payload->>'campaignId' = :cid`, { cid: campaignId })
      .execute();

    // 如果 campaign 已经被标 completed，重新激活回 running
    const c = await this.repo.findOneBy({ id: campaignId });
    if (c && (res.affected ?? 0) > 0 && c.status === CampaignStatus.COMPLETED) {
      c.status = CampaignStatus.RUNNING;
      (c as any).completedAt = null;
      await this.repo.save(c);
    }

    return { retried: res.affected ?? 0 };
  }

  /**
   * 创建 campaign。强制覆盖 dto.tenantId 为调用者租户 (Codex #2 修复),
   * SUPER_ADMIN 才允许 dto 自带 tenantId 跨租户创建.
   * @param callerTenantId 普通用户的 tenantId (必传); SUPER_ADMIN 调用时传 null 表示信任 dto
   */
  create(dto: CreateCampaignDto, callerTenantId: string | null): Promise<Campaign> {
    const tenantId =
      callerTenantId === null
        ? (dto as any).tenantId  // SUPER_ADMIN 模式, 用 dto 提供的
        : callerTenantId;          // 普通用户, 强制写入自己的
    if (!tenantId) {
      throw new BadRequestException('tenantId required (无法从用户或 dto 推断)');
    }
    const campaign = this.repo.create({ ...(dto as Partial<Campaign>), tenantId });
    return this.repo.save(campaign);
  }

  findAll(status?: CampaignStatus, tenantId?: string | null): Promise<Campaign[]> {
    const where: any = {};
    if (status) where.status = status;
    if (tenantId) where.tenantId = tenantId;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  /**
   * 仪表盘 KPI: 广告投放概况。
   * - completedCount: status=COMPLETED 的 campaign 总数
   * - runningCount: status=RUNNING 的 campaign 数
   * - totalSent: 所有 campaign 累计 sentCount
   * - todaySent: 今日新发送的 campaign_single 任务数（status=DONE 且 finishedAt >= 今日）
   */
  async dashboardStats(tenantId?: string): Promise<{
    completedCount: number;
    runningCount: number;
    totalSent: number;
    todaySent: number;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Codex #10 修复: campaigns 早就有 tenantId 字段, 按租户过滤
    const all = await (tenantId
      ? this.repo.find({ where: { tenantId } })
      : this.repo.find());
    let completedCount = 0;
    let runningCount = 0;
    let totalSent = 0;
    for (const c of all) {
      if (c.status === CampaignStatus.COMPLETED) completedCount++;
      if (c.status === CampaignStatus.RUNNING) runningCount++;
      totalSent += c.sentCount ?? 0;
    }

    // 今日发送：从 tasks 表统计 campaign_single done 且 finishedAt >= 今日 (按租户)
    const tqb = this.taskRepo
      .createQueryBuilder('t')
      .where(`t.type = 'campaign_single'`)
      .andWhere(`t.status = 'done'`)
      .andWhere('t.finishedAt >= :today', { today: todayStart });
    if (tenantId) tqb.andWhere('t."tenantId" = :tid', { tid: tenantId });
    const todaySent = await tqb.getCount();

    return { completedCount, runningCount, totalSent, todaySent };
  }

  async findOne(id: string): Promise<Campaign> {
    const campaign = await this.repo.findOneBy({ id });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);
    return campaign;
  }

  /** Codex #1: 租户权属保护版 findOne. callerTenantId=null → 跳过校验 (SUPER_ADMIN/agent) */
  async findOneScoped(id: string, callerTenantId: string | null): Promise<Campaign> {
    const c = await this.repo.findOneBy({ id });
    return ensureTenant(c, callerTenantId, 'Campaign');
  }

  async update(id: string, dto: UpdateCampaignDto, callerTenantId: string | null = null): Promise<Campaign> {
    const campaign = await this.findOneScoped(id, callerTenantId);
    // Codex #2: 普通用户不允许通过 update 改 tenantId 来跨租户迁移
    const safeDto: any = { ...dto };
    if (callerTenantId !== null) delete safeDto.tenantId;
    Object.assign(campaign, safeDto);
    await this.repo.save(campaign);
    return this.findOne(id);
  }

  /**
   * 删除 campaign + 联动取消所有 pending/running 子任务 (Codex #8).
   * 不再"删了 campaign 任务还在跑" — UI 看不到但副作用还在的灾难场景.
   */
  async remove(id: string, callerTenantId: string | null = null): Promise<void> {
    const campaign = await this.findOneScoped(id, callerTenantId);

    // 联动取消子任务 (cancelRequested=true 让 agent in-flight 也立即停)
    const updateRes = await this.taskRepo
      .createQueryBuilder()
      .update(Task)
      .set({
        status: TaskStatus.FAILED,
        errorMsg: `campaign ${id.slice(0, 8)} 已删除`,
        finishedAt: new Date(),
        cancelRequested: true,
      })
      .where(`status IN (:...st)`, { st: [TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.PAUSED] })
      .andWhere(`payload->>'campaignId' = :cid`, { cid: id })
      .execute();
    if (updateRes.affected) {
      this.logger.warn(`remove campaign ${id.slice(0, 8)}: cancelled ${updateRes.affected} child task(s)`);
    }

    await this.repo.remove(campaign);
  }

  async send(id: string, callerTenantId: string | null = null): Promise<{ queued: boolean; targets: number; tasksCreated?: number; days?: number; accountsUsed?: number }> {
    const campaign = await this.findOneScoped(id, callerTenantId);
    campaign.status = CampaignStatus.RUNNING;
    await this.repo.save(campaign);
    const targets = await this.resolveTargetCount(campaign);
    return { queued: true, targets };
  }

  /**
   * 进度回写：每条发送成功后 +1。
   * Codex #5 修复: 校验 task 真实存在 + 防 delta 刷量
   *   - delta 必须 ∈ [1, 10] (单批最多 10)
   *   - 如传 taskId, 必须该 task.payload.campaignId === id, 且 task.tenantId === campaign.tenantId
   *   - 不传 taskId 仅允许 delta=1 (兼容老调用)
   */
  async incrementSent(id: string, delta = 1, taskId?: string): Promise<Campaign> {
    if (!Number.isInteger(delta) || delta < 1 || delta > 10) {
      throw new BadRequestException(`delta 必须是 1-10 之间的整数, got ${delta}`);
    }
    if (!taskId) {
      // Codex round-5 #1: taskId 必填, 否则刷量风险
      throw new BadRequestException('taskId required');
    }
    const c = await this.findOne(id);
    const t = await this.taskRepo.findOneBy({ id: taskId });
    if (!t) throw new NotFoundException(`task ${taskId} not found`);
    const taskCampaignId = (t.payload as any)?.campaignId;
    if (taskCampaignId !== id) {
      throw new ForbiddenException(`task ${taskId.slice(0, 8)} 不属于此 campaign`);
    }
    if (t.tenantId && c.tenantId && t.tenantId !== c.tenantId) {
      throw new ForbiddenException(`task tenant 与 campaign tenant 不匹配`);
    }
    // 早期退出: 如已计数过, 直接返回 (静默幂等)
    if (t.sentCountedAt) {
      this.logger.warn(
        `incrementSent task ${taskId.slice(0, 8)} 已计数过 (at ${t.sentCountedAt.toISOString()}), 拒绝重复`,
      );
      return c;
    }

    // Codex round-7 #2: sentCountedAt + sentCount++ 必须在同一事务里
    // 之前两步可能出现 "task 标 counted 但 campaign 没 +1" 的永久少算
    let counted = false;
    await this.taskRepo.manager.transaction(async (mgr) => {
      const updateResult = await mgr
        .createQueryBuilder()
        .update(Task)
        .set({ sentCountedAt: new Date() })
        .where('id = :id', { id: taskId })
        .andWhere('"sentCountedAt" IS NULL')
        .returning('id')
        .execute();
      const affected = updateResult.affected ?? 0;
      if (affected !== 1) {
        // 并发: 另一个事务已经计数, 本次跳过
        return;
      }
      // 同事务里 increment - 任何一步失败 → 整体回滚, sentCountedAt 也撤销, 下次重试可重新计数
      await mgr.increment(Campaign, { id }, 'sentCount', delta);
      counted = true;
    });

    if (!counted) {
      this.logger.warn(`incrementSent task ${taskId.slice(0, 8)} race lost, 跳过`);
      return c;
    }
    const reloaded = await this.findOne(id);
    this.checkCompletion(id).catch(() => {});
    return reloaded;
  }

  /** Codex #5: 同 incrementSent 校验 */
  async incrementReply(id: string, delta = 1, taskId?: string): Promise<Campaign> {
    if (!Number.isInteger(delta) || delta < 1 || delta > 10) {
      throw new BadRequestException(`delta 必须是 1-10 之间的整数`);
    }
    const c = await this.findOne(id);
    if (taskId) {
      const t = await this.taskRepo.findOneBy({ id: taskId });
      if (!t || (t.payload as any)?.campaignId !== id) {
        throw new ForbiddenException(`task 不属于此 campaign`);
      }
    } else if (delta !== 1) {
      throw new BadRequestException('不传 taskId 时 delta 必须为 1');
    }
    c.replyCount = (c.replyCount ?? 0) + delta;
    await this.repo.save(c);
    return c;
  }

  /**
   * 检查 campaign 是否所有派发出来的任务都已结束（done/failed/canceled）。
   * 是 → 状态切 completed。
   */
  async checkCompletion(id: string): Promise<void> {
    const c = await this.findOne(id);
    if (c.status !== CampaignStatus.RUNNING) return;

    // 统计该 campaign 下所有任务
    const stats = await this.taskRepo
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where(`t.payload->>'campaignId' = :id`, { id })
      .groupBy('t.status')
      .getRawMany();

    if (!stats.length) return; // 没任何任务，可能 dispatch 还没跑

    let total = 0;
    let finished = 0;
    for (const s of stats) {
      const n = parseInt(s.count, 10);
      total += n;
      if (['done', 'failed'].includes(s.status)) {
        finished += n;
      }
    }

    if (total > 0 && finished >= total) {
      c.status = CampaignStatus.COMPLETED;
      c.completedAt = new Date();
      await this.repo.save(c);
    }
  }

  /** 公开方法：强制重新检测某个 campaign 完成状态 (前端可手动触发) */
  async markCompletedIfDone(id: string): Promise<Campaign> {
    await this.checkCompletion(id);
    return this.findOne(id);
  }

  /**
   * 承载力计算
   * 成熟营运号 = role ad/hybrid, healthScore >= MATURE_MIN_HEALTH, 创建 >= MATURE_DAYS 天前
   */
  async capacityCheck(params: {
    targetCount?: number;
    pacePreset?: PacePreset;
    customerGroupIds?: string[];
    extraTargets?: string[];
    tenantId?: string | null;       // Codex #10: 必传 (controller 传当前 tenant)
  }): Promise<{
    targetCount: number;
    matureAccountCount: number;
    totalAccountCount: number;
    capacity: number;
    pacePreset: PacePreset;
    dailyLimit: number;
    safetyLevel: 'safe' | 'warning' | 'risk';
    message: string;
  }> {
    const pace = params.pacePreset ?? PacePreset.CONSERVATIVE;
    const { dailyLimit } = PACE_LIMITS[pace];

    const matureCutoff = new Date();
    matureCutoff.setDate(matureCutoff.getDate() - MATURE_DAYS);

    // Codex #10: 按 tenant 过滤
    const tenantFilter = params.tenantId ? { tenantId: params.tenantId } : {};
    const [matureAd, matureHybrid, totalAdAccounts] = await Promise.all([
      this.accountRepo.count({
        where: {
          role: AccountRole.AD,
          healthScore: MoreThanOrEqual(MATURE_MIN_HEALTH) as any,
          createdAt: LessThan(matureCutoff),
          ...tenantFilter,
        },
      }),
      this.accountRepo.count({
        where: {
          role: AccountRole.HYBRID,
          healthScore: MoreThanOrEqual(MATURE_MIN_HEALTH) as any,
          createdAt: LessThan(matureCutoff),
          ...tenantFilter,
        },
      }),
      this.accountRepo.count({ where: { role: AccountRole.AD, ...tenantFilter } }),
    ]);

    const matureCount = matureAd + matureHybrid;
    const capacity = matureCount * dailyLimit;

    // Resolve actual target count from groups (按 tenant 过滤)
    let resolvedTargets = params.targetCount ?? 0;
    if (params.customerGroupIds?.length) {
      const groups = params.tenantId
        ? await this.groupRepo.find({ where: { id: In(params.customerGroupIds), tenantId: params.tenantId } })
        : await this.groupRepo.findByIds(params.customerGroupIds);
      const groupTotal = groups.reduce((s, g) => s + (g.memberCount ?? 0), 0);
      const extraCount = params.extraTargets?.length ?? 0;
      resolvedTargets = groupTotal + extraCount;
    }

    let safetyLevel: 'safe' | 'warning' | 'risk';
    let message: string;
    if (matureCount === 0) {
      safetyLevel = 'risk';
      message = `没有可用的成熟营运号，请先等账号完成养号 (${MATURE_DAYS} 天)`;
    } else if (resolvedTargets === 0) {
      safetyLevel = 'warning';
      message = '还未设置目标，无法计算承载';
    } else if (capacity >= resolvedTargets) {
      safetyLevel = 'safe';
      message = `承载充足 · 可覆盖全部 ${resolvedTargets} 个目标`;
    } else if (capacity >= Math.ceil(resolvedTargets * 0.5)) {
      safetyLevel = 'warning';
      message = `承载偏紧 · 建议减少目标或拉长投放天数`;
    } else {
      safetyLevel = 'risk';
      message = `承载不足 · 增加执行账号 / 减少投放数量 / 拉长时间`;
    }

    return {
      targetCount: resolvedTargets,
      matureAccountCount: matureCount,
      totalAccountCount: totalAdAccounts,
      capacity,
      pacePreset: pace,
      dailyLimit,
      safetyLevel,
      message,
    };
  }

  private async resolveTargetCount(campaign: Campaign): Promise<number> {
    let count = campaign.targets?.length ?? 0;
    if (campaign.customerGroupIds?.length) {
      const groups = await this.groupRepo.findByIds(campaign.customerGroupIds);
      count += groups.reduce((s, g) => s + (g.memberCount ?? 0), 0);
    }
    return count;
  }
}
