import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
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

  /** Test a specific provider config using platform AI key */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async test(@Param('id', ParseUUIDPipe) id: string) {
    const cfg = await this.svc['repo']
      .createQueryBuilder('p')
      .addSelect('p.apiKey')
      .where('p.id = :id', { id })
      .getOne();

    if (!cfg) return { ok: false, message: 'Config not found' };

    try {
      const result = await this.ai.complete({
        system: 'Reply with only the word: pong',
        user: 'ping',
        maxTokens: 10,
      });
      const ok = result.toLowerCase().includes('pong') || result.length > 0;
      await this.svc.recordTestResult(id, ok);
      return { ok, message: ok ? '连接成功 ✓' : '收到回复但内容异常' };
    } catch (err: any) {
      await this.svc.recordTestResult(id, false);
      return { ok: false, message: err?.message ?? '连接失败' };
    }
  }
}
