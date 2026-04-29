import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { AiAgentService } from './ai-agent.service';
import { AiFaqDto } from './dto/ai-faq.dto';
import { AiReplyDto } from './dto/ai-reply.dto';

@Controller('ai')
export class AiAgentController {
  constructor(private readonly service: AiAgentService) {}

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
