import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateGreetingTemplateDto {
  @IsUUID()
  tenantId: string;

  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  aiScore?: number;
}
