import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateTenantBotDto, UpdateTenantBotDto } from '../tenants/tenant-bot.dto';
import { TenantsService } from '../tenants/tenants.service';
import { BotGatewayService } from './bot-gateway.service';
import { BotReplyService } from './bot-reply.service';

@Controller('tenants/:id/bots')
export class BotGatewayController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly gateway: BotGatewayService,
    private readonly botReply: BotReplyService,
  ) {}

  @Post()
  async create(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateTenantBotDto,
  ) {
    if (!dto.token) throw new BadRequestException('token is required');
    let me;
    try {
      me = await this.botReply.getMe(dto.token);
    } catch (err) {
      throw new BadRequestException(`Invalid bot token: ${(err as Error).message}`);
    }
    const bot = await this.tenants.createBot(tenantId, dto, me.username ?? `bot${me.id}`);
    this.gateway.startPolling(bot.id);
    return bot;
  }

  @Get()
  list(@Param('id', ParseUUIDPipe) tenantId: string) {
    return this.tenants.listBots(tenantId);
  }

  @Patch(':botId')
  update(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
    @Body() dto: UpdateTenantBotDto,
  ) {
    return this.tenants.updateBot(tenantId, botId, dto);
  }

  @Delete(':botId')
  async remove(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
  ) {
    this.gateway.stopPolling(botId);
    await this.tenants.removeBot(tenantId, botId);
    return { ok: true };
  }

  @Post(':botId/start')
  async start(@Param('botId', ParseUUIDPipe) botId: string) {
    await this.tenants.setBotActive(botId, true);
    this.gateway.startPolling(botId);
    return { ok: true };
  }

  @Post(':botId/stop')
  async stop(@Param('botId', ParseUUIDPipe) botId: string) {
    this.gateway.stopPolling(botId);
    await this.tenants.setBotActive(botId, false);
    return { ok: true };
  }
}
