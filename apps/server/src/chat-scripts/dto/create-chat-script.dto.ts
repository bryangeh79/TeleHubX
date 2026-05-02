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
import { ChatScriptType } from '../chat-script.entity';

export class ScriptLineDto {
  @IsString()
  roleLabel: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

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

export class CreateChatScriptDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  name: string;

  @IsEnum(ChatScriptType)
  type: ChatScriptType;

  @IsInt()
  minRound: number;

  @IsInt()
  maxRound: number;

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

  /** 完整 rawScript blob (sessions + turns)，自建剧本编辑器使用 */
  @IsOptional()
  rawScript?: any;
}
