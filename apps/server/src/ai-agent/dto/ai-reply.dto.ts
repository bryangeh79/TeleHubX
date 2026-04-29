import { IsOptional, IsString } from 'class-validator';

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
}
