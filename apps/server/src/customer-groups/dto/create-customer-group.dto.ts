import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCustomerGroupDto {
  @IsUUID()
  tenantId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['manual', 'candidates'])
  sourceType?: 'manual' | 'candidates';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  members?: string[];
}
