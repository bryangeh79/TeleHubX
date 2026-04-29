import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadIntent } from '../lead.entity';

export class CreateLeadDto {
  @IsString()
  tgUserId: string;

  @IsOptional()
  @IsString()
  tgUsername?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  product?: string;

  @IsOptional()
  @IsString()
  budget?: string;

  @IsOptional()
  @IsEnum(LeadIntent)
  intent?: LeadIntent;

  @IsOptional()
  @IsBoolean()
  needsHuman?: boolean;
}
