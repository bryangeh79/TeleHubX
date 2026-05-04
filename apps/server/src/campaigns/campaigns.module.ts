import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from './campaign.entity';
import { Account } from '../accounts/account.entity';
import { CustomerGroup } from '../customer-groups/customer-group.entity';
import { AdTemplate } from '../ad-templates/ad-template.entity';
import { Asset } from '../assets/asset.entity';
import { GreetingTemplate } from '../greeting-templates/greeting-template.entity';
import { LeadCandidate } from '../leads-candidates/lead-candidate.entity';
import { Task } from '../tasks/task.entity';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignDispatchService } from './campaign-dispatch.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    Campaign, Account, CustomerGroup,
    AdTemplate, GreetingTemplate, Task, Asset, LeadCandidate,
  ])],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignDispatchService],
  exports: [CampaignsService, CampaignDispatchService],
})
export class CampaignsModule {}
