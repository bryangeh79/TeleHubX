import { IsOptional, IsString, MinLength } from 'class-validator';

export class BindVerifyDto {
  /** OTP from Telegram app or SMS */
  @IsString()
  @MinLength(4)
  code: string;

  /** Required only if /init's response said `needsPassword: true` */
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}
