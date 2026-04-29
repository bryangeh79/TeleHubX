import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProxyStatus, ProxyType } from '../proxy.entity';

export class UpdateProxyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsEnum(ProxyType)
  type?: ProxyType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  isp?: string;

  @IsOptional()
  @IsEnum(ProxyStatus)
  status?: ProxyStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
