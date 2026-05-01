import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateCustomerGroupDto {
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  name?: string;

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

  @IsOptional()
  @IsInt()
  memberCount?: number;
}
