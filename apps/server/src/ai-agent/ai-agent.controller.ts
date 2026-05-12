import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service';
import { AiFaqDto } from './dto/ai-faq.dto';
import { AiReplyDto } from './dto/ai-reply.dto';
import { AutoReplyDecider } from './decider.service';
import { AllowAgent } from '../auth/roles.decorator';

@Controller('ai')
export class AiAgentController {
  constructor(
    private readonly service: AiAgentService,
    private readonly decider: AutoReplyDecider,
  ) {}

  @Get('info')
  info() {
    return {
      ...this.service.info(),
      decider: this.decider.config_(),
    };
  }

  /** Codex round-10 #1: tenantId 必传 (admin 调试 / 平台测试用) */
  @Post('decide')
  @HttpCode(HttpStatus.OK)
  decide(@Body() body: { chatId: string; userMessage: string; kbId?: string; tenantId: string; botId?: string }) {
    return this.decider.decide({
      chatId: body.chatId,
      userMessage: body.userMessage,
      kbId: body.kbId,
      tenantId: body.tenantId,
      botId: body.botId,
    });
  }

  @Post('reply')
  reply(@Body() dto: AiReplyDto) {
    return this.service.reply(dto);
  }

  @Post('faq')
  faq(@Body() dto: AiFaqDto) {
    return this.service.faq(dto);
  }

  @Delete('conversation/:chatId')
  @HttpCode(HttpStatus.OK)
  clearHistory(@Param('chatId') chatId: string) {
    return this.service.clearHistory(chatId);
  }

  /**
   * vmfix27 #A3: 把单个关键词扩展成 N 个语义变体。
   * 用法: agent 在 discover_groups_by_keyword 任务前先调此接口。
   * @AllowAgent: agent 进程可调（X-Agent-Token），dashboard UI 也可调用
   */
  @Post('expand-keywords')
  @AllowAgent()
  @HttpCode(HttpStatus.OK)
  expandKeywords(@Body() body: { keyword: string; maxVariants?: number; targetLanguages?: string[] }) {
    return this.service.expandKeywords(body);
  }

  /**
   * vmfix27 #B2: AI 给单个群打目标客户匹配度分数。
   * 用法: discover executor 抽样完消息后，可选调用此接口给群打补充分。
   */
  @Post('score-group')
  @AllowAgent()
  @HttpCode(HttpStatus.OK)
  scoreGroup(@Body() body: {
    groupTitle: string;
    groupDescription?: string;
    sampleMessages?: string[];
    targetAudience: string;
  }) {
    return this.service.scoreGroupMatch(body);
  }
}
