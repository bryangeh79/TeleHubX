import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from './campaign.entity';
import { Account } from '../accounts/account.entity';
import { CustomerGroup } from '../customer-groups/customer-group.entity';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [TypeOrmModule.forFeature([Campaign, Account, CustomerGroup])],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
