import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import OpenAI from 'openai';
import { BotReplyService } from '../bot-gateway/bot-reply.service';
import { UpdateTenantSettingsDto } from './tenant-settings.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly service: TenantsService,
    private readonly botReply: BotReplyService,
  ) {}

  @Get()
  findAll() { return this.service.findAll(); }

  @Get('default')
  getDefault() { return this.service.getDefault(); }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) { return this.service.findOne(id); }

  @Get(':id/settings')
  getSettings(@Param('id', ParseUUIDPipe) id: string) { return this.service.getSettings(id); }

  @Patch(':id/settings')
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantSettingsDto) {
    return this.service.updateSettings(id, dto);
  }

  /** 用租户自有 AI Key 发一条 ping 测试连通性 */
  @Post(':id/settings/test-ai')
  @HttpCode(HttpStatus.OK)
  async testAi(@Param('id', ParseUUIDPipe) id: string) {
    const cfg = await this.service.getEffectiveAiConfig(id);
    if (!cfg) {
      return { ok: false, message: '还没有配置 AI Key，请先填写' };
    }
    try {
      const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
      const completion = await client.chat.completions.create({
        model: cfg.model,
        messages: [
          { role: 'system', content: 'Reply with only the word: pong' },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 10,
        temperature: 0,
      });
      const reply = completion.choices[0]?.message?.content ?? '';
      const ok = reply.length > 0;
      return {
        ok,
        message: ok
          ? `连接成功 ✓ (${cfg.provider} · ${cfg.model} · ${cfg.source === 'tenant' ? '租户 Key' : '平台兜底'})`
          : '收到回复但内容异常',
      };
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('authentication')) {
        return { ok: false, message: `API Key 无效，请检查 ${cfg.provider} 的 Key 是否正确` };
      }
      if (msg.includes('404') || msg.includes('model')) {
        return { ok: false, message: `模型 "${cfg.model}" 不存在，请检查模型名称` };
      }
      return { ok: false, message: `连接失败: ${msg.slice(0, 100)}` };
    }
  }

  /**
   * 测试推送一条消息给 operator Telegram chatId（验证人工接管通知是否能送达）。
   * 失败 = operator 没和 Bot 主动 /start 过 / chatId 错 / Bot 被 ban。
   */
  @Post(':id/settings/test-notify-agent')
  @HttpCode(HttpStatus.OK)
  async testNotifyAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { chatId: string; name?: string },
  ) {
    if (!body?.chatId?.trim()) return { ok: false, message: 'chatId 必填' };
    const bot = await this.service.findActiveBotByTenantWithToken(id);
    if (!bot) return { ok: false, message: '该租户还没有 active 的 Bot，请先注册并启动 Bot' };

    const text = `🧪 测试通知\n\n你已被加入「${bot.botUsername}」的人工客服列表，可以正常收到接管推送。\n\n（如收到此消息说明配置正确）`;
    const result = await this.botReply.sendText(bot.rawToken, body.chatId.trim(), text);
    if (result.ok) {
      return { ok: true, message: `已推送到 chatId=${body.chatId}，请到 Telegram 检查` };
    }
    const desc = result.description ?? '';
    if (desc.includes('chat not found') || result.status === 400) {
      return {
        ok: false,
        message: '推送失败：客服未给 Bot 发过 /start，或 chatId 错误。请让该客服先在 Telegram 主动给 Bot 发一次 /start',
      };
    }
    if (desc.includes('blocked') || result.status === 403) {
      return { ok: false, message: '客服已 block 此 Bot，请取消 block 后重试' };
    }
    return { ok: false, message: `推送失败 (${result.status ?? '?'}): ${desc.slice(0, 100)}` };
  }
}
