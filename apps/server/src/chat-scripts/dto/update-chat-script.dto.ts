import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ChatScriptStatus, ChatScriptType } from '../chat-script.entity';

export class ScriptLineDto {
  @IsString()
  roleLabel: 'A' | 'B' | 'C' | 'D';

  @IsString()
  text: string;

  @IsOptional()
  @IsBoolean()
  allowEmoji?: boolean;

  @IsOptional()
  @IsNumber()
  delayAfterMs?: number;

  @IsOptional()
  @IsNumber()
  delayStdDevMs?: number;
}

export class UpdateChatScriptDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ChatScriptType)
  type?: ChatScriptType;

  @IsOptional()
  @IsInt()
  minRound?: number;

  @IsOptional()
  @IsInt()
  maxRound?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  groupIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accountIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScriptLineDto)
  lines?: ScriptLineDto[];

  @IsOptional()
  @IsEnum(ChatScriptStatus)
  status?: ChatScriptStatus;
}
