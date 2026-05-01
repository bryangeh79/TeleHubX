import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
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

  @IsOptional()
  healthScore?: number;

  /** agent 端首次连接 client.getMe() 后回填 */
  @IsString()
  @IsOptional()
  tgUserId?: string;

  @IsOptional()
  quarantineUntil?: string | Date;

  @IsString()
  @IsOptional()
  quarantineReason?: string;
}
