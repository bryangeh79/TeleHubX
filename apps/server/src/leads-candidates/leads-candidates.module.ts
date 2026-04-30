import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadCandidate } from './lead-candidate.entity';
import { LeadCandidatesController } from './leads-candidates.controller';
import { LeadCandidatesService } from './leads-candidates.service';

@Module({
  imports: [TypeOrmModule.forFeature([LeadCandidate])],
  controllers: [LeadCandidatesController],
  providers: [LeadCandidatesService],
  exports: [LeadCandidatesService],
})
export class LeadCandidatesModule {}
