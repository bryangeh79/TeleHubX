import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import {
  Campaign,
  CampaignStatus,
  MATURE_DAYS,
  MATURE_MIN_HEALTH,
  PACE_LIMITS,
  PacePreset,
} from './campaign.entity';
import { Account, AccountRole } from '../accounts/account.entity';
import { CustomerGroup } from '../customer-groups/customer-group.entity';
import { Task } from '../tasks/task.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
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

  /** 列出某 campaign 派发出来的所有子任务（用于日志查看） */
  async listTasks(campaignId: string): Promise<{
    summary: { total: number; pending: number; running: number; done: number; failed: number; paused: number };
    tasks: Array<{
      id: string; seq: number | null; status: string;
      accountLabel: string | null; target: string | null;
      scheduledAt: Date; startedAt: Date | null; finishedAt: Date | null;
      errorMsg: string | null;
    }>;
  }> {
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

  create(dto: CreateCampaignDto): Promise<Campaign> {
    const campaign = this.repo.create(dto as Partial<Campaign>);
    return this.repo.save(campaign);
  }

  findAll(status?: CampaignStatus): Promise<Campaign[]> {
    const where = status ? { status } : {};
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Campaign> {
    const campaign = await this.repo.findOneBy({ id });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.findOne(id);
    Object.assign(campaign, dto);
    await this.repo.save(campaign);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const campaign = await this.findOne(id);
    await this.repo.remove(campaign);
  }

  async send(id: string): Promise<{ queued: boolean; targets: number; tasksCreated?: number; days?: number; accountsUsed?: number }> {
    const campaign = await this.findOne(id);
    // dispatch 在 controller 层调用 (避免循环依赖)
    campaign.status = CampaignStatus.RUNNING;
    await this.repo.save(campaign);
    const targets = await this.resolveTargetCount(campaign);
    return { queued: true, targets };
  }

  /** 进度回写：每条发送成功后 +1，并检查是否完成 */
  async incrementSent(id: string, delta = 1): Promise<Campaign> {
    const c = await this.findOne(id);
    c.sentCount = (c.sentCount ?? 0) + delta;
    await this.repo.save(c);
    // 异步检查完成状态（不阻塞回写）
    this.checkCompletion(id).catch(() => {});
    return c;
  }

  async incrementReply(id: string, delta = 1): Promise<Campaign> {
    const c = await this.findOne(id);
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

    const [matureAd, matureHybrid, totalAdAccounts] = await Promise.all([
      this.accountRepo.count({
        where: {
          role: AccountRole.AD,
          healthScore: MoreThanOrEqual(MATURE_MIN_HEALTH) as any,
          createdAt: LessThan(matureCutoff),
        },
      }),
      this.accountRepo.count({
        where: {
          role: AccountRole.HYBRID,
          healthScore: MoreThanOrEqual(MATURE_MIN_HEALTH) as any,
          createdAt: LessThan(matureCutoff),
        },
      }),
      this.accountRepo.count({ where: { role: AccountRole.AD } }),
    ]);

    const matureCount = matureAd + matureHybrid;
    const capacity = matureCount * dailyLimit;

    // Resolve actual target count from groups
    let resolvedTargets = params.targetCount ?? 0;
    if (params.customerGroupIds?.length) {
      const groups = await this.groupRepo.findByIds(params.customerGroupIds);
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
