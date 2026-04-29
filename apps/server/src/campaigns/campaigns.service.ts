import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign, CampaignStatus } from './campaign.entity';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectRepository(Campaign)
    private readonly repo: Repository<Campaign>,
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
    return this.repo.save(campaign);
  }

  async remove(id: string): Promise<void> {
    const campaign = await this.findOne(id);
    await this.repo.remove(campaign);
  }

  async send(id: string): Promise<{ queued: boolean; targets: number }> {
    const campaign = await this.findOne(id);
    campaign.status = CampaignStatus.RUNNING;
    await this.repo.save(campaign);
    // Placeholder: actual dispatch will be handled by BullMQ job in Phase 3 full impl
    return { queued: true, targets: campaign.targets?.length ?? 0 };
  }
}
