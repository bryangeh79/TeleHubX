import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { FaqSource } from '../faq.entity';

export class CreateFaqDto {
  @IsUUID()
  kbId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  answer: string;

  @IsOptional()
  @IsEnum(FaqSource)
  source?: FaqSource;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateFaqDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  answer?: string;

  @IsOptional()
  @IsEnum(FaqSource)
  source?: FaqSource;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class SearchFaqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query: string;

  @IsOptional()
  @IsUUID()
  kbId?: string;
}
