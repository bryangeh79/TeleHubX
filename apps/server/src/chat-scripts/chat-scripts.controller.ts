import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ChatScriptStatus, ChatScriptType } from './chat-script.entity';
import { ChatScriptsService } from './chat-scripts.service';
import { CreateChatScriptDto } from './dto/create-chat-script.dto';
import { UpdateChatScriptDto } from './dto/update-chat-script.dto';

@Controller('chat-scripts')
export class ChatScriptsController {
  constructor(private readonly service: ChatScriptsService) {}

  @Post()
  create(@Body() dto: CreateChatScriptDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('type') type?: ChatScriptType,
    @Query('status') status?: ChatScriptStatus,
  ) {
    return this.service.findAll(type, status);
  }

  /** Agent 端 chat_script_* 任务调用：随机抽一个 active 剧本（含 rawScript）。 */
  @Get('random')
  async pickRandom(
    @Query('packId') packId?: string,
    @Query('category') category?: string,
    @Query('type') type?: ChatScriptType,
  ) {
    const s = await this.service.pickRandom({ packId, category, type });
    if (!s) {
      // 不抛 404 — 让 agent 优雅处理 null
      return null;
    }
    return s;
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChatScriptDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  @Post('seed/ab')
  @HttpCode(HttpStatus.CREATED)
  seedAb() {
    return this.service.seedAb();
  }

  @Post('seed/abcd')
  @HttpCode(HttpStatus.CREATED)
  seedAbcd() {
    return this.service.seedAbcd();
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  execute(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.execute(id);
  }
}
