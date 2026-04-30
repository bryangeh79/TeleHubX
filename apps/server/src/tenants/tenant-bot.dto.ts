import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateTenantBotDto {
  @IsString()
  token: string;
}

export class UpdateTenantBotDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  botUsername?: string;
}
