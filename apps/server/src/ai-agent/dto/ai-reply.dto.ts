import { IsIn, IsOptional, IsString } from 'class-validator';
import type { AiProviderId } from '../ai-providers';

export class AiReplyDto {
  @IsString()
  chatId: string;

  @IsString()
  userMessage: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsIn(['openai', 'deepseek', 'gemini'])
  provider?: AiProviderId;

  @IsOptional()
  @IsString()
  model?: string;
}
