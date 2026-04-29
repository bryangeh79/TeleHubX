import {
  IsEnum,
  IsObject,
  IsOptional,
} from 'class-validator';
import { AccountRole, AccountStatus, ProxyConfig } from '../account.entity';

export class UpdateAccountDto {
  @IsEnum(AccountRole)
  @IsOptional()
  role?: AccountRole;

  @IsEnum(AccountStatus)
  @IsOptional()
  status?: AccountStatus;

  @IsObject()
  @IsOptional()
  proxyConfig?: ProxyConfig;
}
