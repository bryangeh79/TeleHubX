export class CreateTenantBotDto {
  token: string;
}

export class UpdateTenantBotDto {
  isActive?: boolean;
  botUsername?: string;
}
