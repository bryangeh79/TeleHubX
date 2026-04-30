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

  /**
   * 诊断：查询 bot 当前的 webhook 状态。
   * 如果 url 非空 → 消息被发到那个 webhook，我们的 long-polling 拿不到。
   * pendingUpdateCount > 0 → 有一批积压消息（webhook 解锁后会爆灌过来）。
   */
  @Get(':botId/webhook-info')
  async webhookInfo(
    @Param('id', ParseUUIDPipe) _tenantId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
  ) {
    const bot = await this.tenants.findBotWithToken(botId);
    return this.botReply.getWebhookInfo(bot.rawToken);
  }

  /**
   * 清除 webhook + 丢弃积压。我们的 long-polling 立即独占消息流。
   * 一键修复"bot 不响应到 dashboard"问题。
   */
  @Post(':botId/clear-webhook')
  async clearWebhook(
    @Param('id', ParseUUIDPipe) _tenantId: string,
    @Param('botId', ParseUUIDPipe) botId: string,
  ) {
    const bot = await this.tenants.findBotWithToken(botId);
    return this.botReply.deleteWebhook(bot.rawToken);
  }
}
