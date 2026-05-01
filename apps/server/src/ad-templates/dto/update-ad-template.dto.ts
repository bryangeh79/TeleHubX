import { IsArray, IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateAdTemplateDto {
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
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  hasMedia?: boolean;

  @IsOptional()
  @IsUUID()
  mediaAssetId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
