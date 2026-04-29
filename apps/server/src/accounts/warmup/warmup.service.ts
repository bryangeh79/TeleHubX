import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WarmupPlan } from './warmup-plan.entity';

export const WARMUP_PHASE_LABELS: Record<number, string> = {
  0: 'P0:Initialize',
  1: 'P1:SilentObserve',
  2: 'P2:LightActivity',
  3: 'P3:SocialBuilding',
  4: 'P4:NormalOps',
};

@Injectable()
export class WarmupService {
  constructor(
    @InjectRepository(WarmupPlan)
    private readonly repo: Repository<WarmupPlan>,
  ) {}

  async start(accountId: string): Promise<WarmupPlan> {
    const existing = await this.repo.findOneBy({ accountId });
    if (existing) throw new ConflictException(`Warmup already started for account ${accountId}`);

    const plan = this.repo.create({
      accountId,
      currentPhase: 0,
      phaseStartedAt: { '0': new Date().toISOString() },
      actionsLog: [{ phase: 0, action: 'warmup_started', ts: new Date().toISOString() }],
    });
    return this.repo.save(plan);
  }

  async advance(accountId: string): Promise<WarmupPlan> {
    const plan = await this.findByAccount(accountId);
    if (plan.completed) throw new ConflictException('Warmup already completed');
    if (plan.currentPhase >= 4) {
      plan.completed = true;
    } else {
      plan.currentPhase += 1;
      plan.phaseStartedAt = {
        ...(plan.phaseStartedAt || {}),
        [plan.currentPhase]: new Date().toISOString(),
      };
    }
    plan.actionsLog = [
      ...(plan.actionsLog || []),
      {
        phase: plan.currentPhase,
        action: plan.completed ? 'warmup_completed' : `advanced_to_phase_${plan.currentPhase}`,
        ts: new Date().toISOString(),
      },
    ];
    return this.repo.save(plan);
  }

  async pause(accountId: string): Promise<WarmupPlan> {
    const plan = await this.findByAccount(accountId);
    if (plan.completed) throw new ConflictException('Warmup already completed');
    if (plan.paused) throw new ConflictException('Warmup already paused');
    plan.paused = true;
    plan.pausedAt = new Date();
    plan.actionsLog = [
      ...(plan.actionsLog || []),
      { phase: plan.currentPhase, action: 'paused', ts: new Date().toISOString() },
    ];
    return this.repo.save(plan);
  }

  async resume(accountId: string): Promise<WarmupPlan> {
    const plan = await this.findByAccount(accountId);
    if (plan.completed) throw new ConflictException('Warmup already completed');
    if (!plan.paused) throw new ConflictException('Warmup is not paused');
    plan.paused = false;
    plan.pausedAt = null;
    plan.actionsLog = [
      ...(plan.actionsLog || []),
      { phase: plan.currentPhase, action: 'resumed', ts: new Date().toISOString() },
    ];
    return this.repo.save(plan);
  }

  async logAction(accountId: string, action: string): Promise<void> {
    const plan = await this.findByAccount(accountId);
    plan.actionsLog = [
      ...(plan.actionsLog || []),
      { phase: plan.currentPhase, action, ts: new Date().toISOString() },
    ];
    await this.repo.save(plan);
  }

  async getStatus(accountId: string): Promise<WarmupPlan & { phaseLabel: string }> {
    const plan = await this.findByAccount(accountId);
    return Object.assign(plan, { phaseLabel: WARMUP_PHASE_LABELS[plan.currentPhase] ?? 'Unknown' });
  }

  async findAll(): Promise<WarmupPlan[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  private async findByAccount(accountId: string): Promise<WarmupPlan> {
    const plan = await this.repo.findOneBy({ accountId });
    if (!plan) throw new NotFoundException(`No warmup plan for account ${accountId}`);
    return plan;
  }
}
