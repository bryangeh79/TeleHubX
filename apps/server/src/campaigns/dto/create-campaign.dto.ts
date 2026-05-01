import {
  IsArray, IsDateString, IsEnum, IsInt, IsOptional,
  IsString, IsUUID, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AccountSourceMode, CampaignType, GreetingMode,
  PacePreset, ScheduleMode,
} from '../campaign.entity';

class MessageVariantDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;
}

export class CreateCampaignDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType;

  @IsOptional()
  @IsString()
  status?: string;

  // Targeting
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerGroupIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targets?: string[];

  // Content
  @IsOptional()
  @IsUUID()
  adTemplateId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  adTemplateIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageVariantDto)
  messageVariants?: MessageVariantDto[];

  @IsOptional()
  @IsEnum(GreetingMode)
  greetingMode?: GreetingMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  greetingTemplateIds?: string[];

  // Schedule
  @IsOptional()
  @IsEnum(ScheduleMode)
  scheduleMode?: ScheduleMode;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  scheduleTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  scheduleDayOfWeek?: number;

  // Execution
  @IsOptional()
  @IsEnum(AccountSourceMode)
  accountSourceMode?: AccountSourceMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  adAccountIds?: string[];

  @IsOptional()
  @IsEnum(PacePreset)
  pacePreset?: PacePreset;
}
