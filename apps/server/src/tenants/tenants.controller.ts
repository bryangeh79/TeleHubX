import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import OpenAI from 'openai';
import { UpdateTenantSettingsDto } from './tenant-settings.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

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
}
