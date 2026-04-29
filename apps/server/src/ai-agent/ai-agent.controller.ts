import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service';
import { AiFaqDto } from './dto/ai-faq.dto';
import { AiReplyDto } from './dto/ai-reply.dto';
import { AutoReplyDecider } from './decider.service';

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

  @Post('decide')
  @HttpCode(HttpStatus.OK)
  decide(@Body() body: { chatId: string; userMessage: string; kbId?: string }) {
    return this.decider.decide({
      chatId: body.chatId,
      userMessage: body.userMessage,
      kbId: body.kbId,
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
}
