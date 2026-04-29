import { IsArray, IsDateString, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CampaignType } from '../campaign.entity';

class MessageVariantDto {
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(CampaignType)
  type?: CampaignType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targets?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageVariantDto)
  messageVariants?: MessageVariantDto[];

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
