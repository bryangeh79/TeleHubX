import { IsOptional, IsString } from 'class-validator';

export class AiFaqDto {
  @IsString()
  question: string;

  @IsOptional()
  @IsString()
  context?: string;
}
