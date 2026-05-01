import {
  IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID,
  Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class GreetingVariantDto {
  @IsString()
  text: string;
}

export class UpdateGreetingTemplateDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  aiScore?: number;

  @IsOptional()
  @IsBoolean()
  aiVariantEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GreetingVariantDto)
  variants?: GreetingVariantDto[];
}
