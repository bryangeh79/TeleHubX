import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ReplyMode } from './tenant-settings.entity';

export class UpdateTenantSettingsDto {
  @IsOptional()
  @IsEnum(ReplyMode)
  replyMode?: ReplyMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  dailyReplyLimit?: number;

  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietHoursStart must be HH:MM' })
  quietHoursStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'quietHoursEnd must be HH:MM' })
  quietHoursEnd?: string;
}
