import { IsArray, IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAdTemplateDto {
  @IsUUID()
  tenantId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  content: string;

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
