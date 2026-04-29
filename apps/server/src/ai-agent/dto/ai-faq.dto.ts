import { IsIn, IsOptional, IsString } from 'class-validator';
import type { AiProviderId } from '../ai-providers';

export class AiFaqDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsIn(['openai', 'deepseek', 'gemini'])
  provider?: AiProviderId;

  @IsOptional()
  @IsString()
  model?: string;
}
