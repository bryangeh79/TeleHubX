import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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
}
