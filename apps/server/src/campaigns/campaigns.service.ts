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
  ) {}

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

  async send(id: string): Promise<{ queued: boolean; targets: number }> {
    const campaign = await this.findOne(id);
    campaign.status = CampaignStatus.RUNNING;
    await this.repo.save(campaign);
    const targets = await this.resolveTargetCount(campaign);
    return { queued: true, targets };
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
