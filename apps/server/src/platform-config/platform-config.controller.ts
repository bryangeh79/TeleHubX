import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Put,
} from '@nestjs/common';
import OpenAI from 'openai';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';
import {
  DEFAULT_AD_GROUP_FAQ, DEFAULT_AD_PRIVATE_DIVERT,
  DEFAULT_GLOBAL_PERSONA, DEFAULT_VARIANT_PROMPT, PlatformConfigService,
} from './platform-config.service';
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

  // ── Platform KV Settings ─────────────────────────────────────────────

  @Get('settings/variant-prompt')
  async getVariantPrompt() {
    const value = await this.svc.getVariantPrompt();
    return { key: 'variant_prompt_template', value, isDefault: value === DEFAULT_VARIANT_PROMPT };
  }

  @Put('settings/variant-prompt')
  async setVariantPrompt(@Body() body: { value: string }) {
    if (!body.value?.trim()) {
      return { ok: false, message: 'Prompt 不能为空' };
    }
    await this.svc.setSetting('variant_prompt_template', body.value.trim());
    return { ok: true };
  }

  @Post('settings/variant-prompt/reset')
  @HttpCode(HttpStatus.OK)
  async resetVariantPrompt() {
    await this.svc.resetVariantPrompt();
    return { ok: true, value: DEFAULT_VARIANT_PROMPT };
  }

  // ── AI 客服人设 ────────────────────────────────────────────────────

  @Get('settings/global-persona')
  async getGlobalPersona() {
    const value = await this.svc.getGlobalPersona();
    return { key: 'global_ai_persona', value, isDefault: value === DEFAULT_GLOBAL_PERSONA };
  }

  @Put('settings/global-persona')
  async setGlobalPersona(@Body() body: { value: string }) {
    if (!body.value?.trim()) return { ok: false, message: '人设内容不能为空' };
    await this.svc.setGlobalPersona(body.value.trim());
    return { ok: true };
  }

  @Post('settings/global-persona/reset')
  @HttpCode(HttpStatus.OK)
  async resetGlobalPersona() {
    await this.svc.resetGlobalPersona();
    return { ok: true, value: DEFAULT_GLOBAL_PERSONA };
  }

  // ── 广告号话术 ─────────────────────────────────────────────────────

  @Get('settings/ad-faq')
  getAdFaq() {
    return this.svc.getAdFaqConfig();
  }

  @Put('settings/ad-faq')
  async setAdFaq(@Body() body: { groupFaq?: string; privateDivert?: string }) {
    await this.svc.setAdFaqConfig(body);
    return { ok: true };
  }

  @Post('settings/ad-faq/reset')
  @HttpCode(HttpStatus.OK)
  async resetAdFaq() {
    await this.svc.setAdFaqConfig({
      groupFaq: DEFAULT_AD_GROUP_FAQ,
      privateDivert: DEFAULT_AD_PRIVATE_DIVERT,
    });
    return { ok: true, groupFaq: DEFAULT_AD_GROUP_FAQ, privateDivert: DEFAULT_AD_PRIVATE_DIVERT };
  }

  // ── 行业话术 ───────────────────────────────────────────────────────

  @Get('settings/industry-prompts')
  async getIndustryPrompts() {
    const prompts = await this.svc.getIndustryPrompts();
    return { prompts };
  }

  @Put('settings/industry-prompts')
  async setIndustryPrompts(@Body() body: { prompts: Record<string, string> }) {
    if (!body?.prompts || typeof body.prompts !== 'object') {
      return { ok: false, message: 'prompts 必须是 { 行业: 话术 } 对象' };
    }
    await this.svc.setIndustryPrompts(body.prompts);
    const saved = await this.svc.getIndustryPrompts();
    return { ok: true, prompts: saved };
  }

  @Post('settings/industry-prompts/reset')
  @HttpCode(HttpStatus.OK)
  async resetIndustryPrompts() {
    await this.svc.resetIndustryPrompts();
    const prompts = await this.svc.getIndustryPrompts();
    return { ok: true, prompts };
  }
}
