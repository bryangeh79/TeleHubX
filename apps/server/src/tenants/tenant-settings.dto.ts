import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';
import { ReplyMode, TenantAiProvider } from './tenant-settings.entity';

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

  // 租户自有 AI（customer chat 用）
  @IsOptional()
  @IsEnum(TenantAiProvider)
  tenantAiProvider?: TenantAiProvider | null;

  /** Plaintext key from UI; service will encrypt before persisting. Empty string clears. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  tenantAiApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenantAiModel?: string | null;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(256)
  tenantAiBaseUrl?: string | null;

  /** 执行组别数量。0 = 未启用; 2-9 = 启用并自动排期。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  groupCount?: number;
}
