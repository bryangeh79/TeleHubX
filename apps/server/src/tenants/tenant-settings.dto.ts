import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ReplyMode, TenantAiProvider } from './tenant-settings.entity';

export class HumanAgentDto {
  @IsString()
  @MaxLength(64)
  chatId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsBoolean()
  enabled: boolean;
}

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

  /** 人工接管 operator 列表（jsonb）。整表覆盖。 */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HumanAgentDto)
  humanAgents?: HumanAgentDto[];

  /**
   * i18n V1: 业务内容默认编辑/发布语言.
   * zh / en / ms / vi 之一. 默认 'zh'.
   */
  @IsOptional()
  @IsString()
  @Matches(/^(zh|en|ms|vi)$/, { message: 'contentDefaultLanguage 必须是 zh/en/ms/vi 之一' })
  contentDefaultLanguage?: string;

  /**
   * i18n V1: 客户回复语言.
   * 'auto' (按客户消息识别) | 'zh' | 'en' | 'ms' | 'vi'. 默认 'auto'.
   * 本轮仅持久化字段, BotGateway / AI 主流程未接入 — 仍按现有行为回复.
   */
  @IsOptional()
  @IsString()
  @Matches(/^(auto|zh|en|ms|vi)$/, { message: 'customerReplyLanguage 必须是 auto/zh/en/ms/vi 之一' })
  customerReplyLanguage?: string;
}
