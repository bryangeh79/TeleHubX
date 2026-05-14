import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChatScriptStatus, ChatScriptType } from './chat-script.entity';
import { ChatScriptsService } from './chat-scripts.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { AllowAgent } from '../auth/roles.decorator';

function isAgentRequest(req: Request): boolean {
  return !!(req.headers['x-agent-token']);
}
import { resolveTenantIdSoft } from '../auth/tenant-resolver';
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
    @CurrentUser() user: AuthUser,
    @Query('type') type?: ChatScriptType,
    @Query('status') status?: ChatScriptStatus,
    @Query('tenantId') tid?: string,
  ) {
    return this.service.findAll(type, status, resolveTenantIdSoft(user, tid));
  }

  /**
   * 列出所有剧本包（供 dashboard 剧本管理页面）。
   * vmfix30 A3: 加 tenantId 过滤防跨租户 leak。
   */
  @Get('packs')
  listPacks(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tid?: string,
  ) {
    return this.service.listPacks(resolveTenantIdSoft(user, tid));
  }

  /** 删除整个剧本包（包括所有剧本）。 */
  @Delete('packs/:packId')
  @HttpCode(HttpStatus.OK)
  deletePack(@Param('packId') packId: string) {
    return this.service.deletePack(packId);
  }

  /**
   * 上传剧本包 JSON 文件。文件格式参考 WAhubX 的 scripts_pack_*.json:
   *   { pack_id / pack_ref, scripts: [{ id, name, sessions: [{turns: [...]}] }] }
   */
  @Post('packs/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadPack(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    let blob: any;
    try {
      blob = JSON.parse(file.buffer.toString('utf-8'));
    } catch (e) {
      throw new BadRequestException('JSON parse failed: ' + (e as Error).message);
    }
    return this.service.importPackBlob(blob);
  }

  /** Agent 端 chat_script_* 任务调用：随机抽一个 active 剧本（含 rawScript）。
   *  Codex round-3 #4: agent 必须传 tenantId 否则拒绝 (内置共享 tenantId=null 例外) */
  @Get('random')
  @AllowAgent()
  async pickRandom(
    @Req() req: Request,
    @Query('packId') packId?: string,
    @Query('category') category?: string,
    @Query('type') type?: ChatScriptType,
    @Query('tenantId') tenantId?: string,
  ) {
    if (isAgentRequest(req) && !tenantId) {
      // agent 不传 tenantId 不允许拉随机 (会跨租户)
      throw new BadRequestException('agent 调用必须传 tenantId');
    }
    const s = await this.service.pickRandom({ packId, category, type, tenantId } as any);
    if (!s) return null;
    if (tenantId && (s as any).tenantId && (s as any).tenantId !== tenantId) return null;
    return s;
  }

  @Get(':id')
  @AllowAgent()
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
  ) {
    const s = await this.service.findOne(id);
    if (isAgentRequest(req)) {
      if (!tenantId && (s as any).tenantId) {
        throw new BadRequestException('agent 调用必须传 tenantId');
      }
      if (tenantId && (s as any).tenantId && (s as any).tenantId !== tenantId) {
        return null;
      }
    } else if (tenantId && (s as any).tenantId && (s as any).tenantId !== tenantId) {
      return null;
    }
    return s;
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
