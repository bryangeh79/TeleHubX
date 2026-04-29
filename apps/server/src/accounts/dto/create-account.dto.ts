import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { AccountRole, ProxyConfig } from '../account.entity';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsEnum(AccountRole)
  @IsOptional()
  role?: AccountRole;

  @IsObject()
  @IsOptional()
  proxyConfig?: ProxyConfig;

  @IsString()
  @IsOptional()
  sessionString?: string;
}
