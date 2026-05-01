import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import OpenAI from 'openai';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';
import { PlatformConfigService } from './platform-config.service';
import { AiAgentService } from '../ai-agent/ai-agent.service';

@Controller('platform-config/ai')
export class PlatformConfigController {
  constructor(
    private readonly svc: PlatformConfigService,
    private readonly ai: AiAgentService,
  ) {}

  @Get()
  list() { return this.svc.listProviders(); }

  @Post()
  create(@Body() dto: {
    provider: string; name?: string; apiKey: string;
    model?: string; baseUrl?: string; isDefault?: boolean;
  }) {
    return this.svc.createProvider(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.svc.updateProvider(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteProvider(id);
  }

  /**
   * Test a specific provider config using THAT record's own key/model/baseUrl.
   * Does NOT use platform default — tests exactly what was saved.
   */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(@Param('id', ParseUUIDPipe) id: string) {
    const cfg = await this.svc['repo']
      .createQueryBuilder('p')
      .addSelect('p.apiKey')
      .where('p.id = :id', { id })
      .getOne();

    if (!cfg) return { ok: false, message: '找不到该配置' };
    if (!cfg.apiKey) return { ok: false, message: 'API Key 未填写' };

    try {
      const providerId = isAiProviderId(cfg.provider) ? cfg.provider : 'openai';
      const providerDef = AI_PROVIDERS[providerId];
      const baseUrl = cfg.baseUrl || providerDef.baseUrl;
      const model = cfg.model || providerDef.defaultModel;

      const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: baseUrl });
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'Reply with only the word: pong' },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 10,
        temperature: 0,
      });
      const reply = completion.choices[0]?.message?.content ?? '';
      const ok = reply.length > 0;
      await this.svc.recordTestResult(id, ok);
      return { ok, message: ok ? `连接成功 ✓ (${providerId} · ${model})` : '收到回复但内容异常' };
    } catch (err: any) {
      await this.svc.recordTestResult(id, false);
      const msg: string = err?.message ?? '';
      // Humanize common errors
      if (msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('authentication')) {
        return { ok: false, message: `API Key 无效，请检查 ${cfg.provider} 的 Key 是否正确` };
      }
      if (msg.includes('404') || msg.includes('model')) {
        return { ok: false, message: `模型 "${cfg.model}" 不存在，请检查模型名称` };
      }
      if (msg.includes('ECONNREFUSED') || msg.includes('network') || msg.includes('fetch')) {
        return { ok: false, message: `连接失败，请检查 Base URL 是否正确` };
      }
      return { ok: false, message: `测试失败: ${msg.slice(0, 100)}` };
    }
  }
}
