import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AccountRole, ProxyConfig } from '../account.entity';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsEnum(AccountRole)
  @IsOptional()
  role?: AccountRole;

  /** Inline proxy config (legacy/manual). Prefer proxyId for catalog reference. */
  @IsObject()
  @IsOptional()
  proxyConfig?: ProxyConfig;

  /** Reference to a pre-configured proxy in the proxies catalog. */
  @IsUUID()
  @IsOptional()
  proxyId?: string;

  @IsString()
  @IsOptional()
  sessionString?: string;
}
