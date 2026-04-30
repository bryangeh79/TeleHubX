import {
  BadRequestException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BotReplyService } from '../bot-gateway/bot-reply.service';
import { LeadTakeover } from '../leads/lead.entity';
import { LeadsService } from '../leads/leads.service';
import { TenantsService } from '../tenants/tenants.service';
import { TakeoverGateway } from './takeover.gateway';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@Controller('takeover')
export class TakeoverController {
  constructor(
    private readonly leads: LeadsService,
    private readonly tenants: TenantsService,
    private readonly botReply: BotReplyService,
    private readonly gateway: TakeoverGateway,
  ) {}

  /**
   * 操作员通过此端点上传文件 → 我们转发到 TG → 客户在 TG 看到媒体。
   * 自动按 mime 选 sendPhoto / sendVideo / sendDocument。
   */
  @Post('leads/:leadId/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ ok: boolean; description?: string }> {
    if (!file) throw new BadRequestException('No file uploaded under field "file"');

    const lead = await this.leads.findOne(leadId);
    if (lead.takeoverState !== LeadTakeover.HUMAN) {
      throw new ForbiddenException('该对话未处于人工接管状态，请先点「接管」');
    }
    if (!lead.tenantId || !lead.tgUserId) {
      throw new BadRequestException('lead 缺少 tenantId 或 tgUserId');
    }

    const bots = await this.tenants.listBots(lead.tenantId);
    const activeBot = bots.find((b) => b.isActive) ?? bots[0];
    if (!activeBot) throw new NotFoundException('该 tenant 还没配置 Bot');
    const botWithToken = await this.tenants.findBotWithToken(activeBot.id);
    const token = botWithToken.rawToken;

    // 按 mime 类型决定调哪个 TG API
    const mime = file.mimetype.toLowerCase();
    const kind: 'photo' | 'video' | 'document' = mime.startsWith('image/')
      ? 'photo'
      : mime.startsWith('video/')
        ? 'video'
        : 'document';

    const sent = await this.botReply.sendMedia(
      token,
      lead.tgUserId,
      kind,
      { buffer: file.buffer, filename: file.originalname, mimetype: mime },
      undefined,
    );
    if (!sent.ok) {
      return { ok: false, description: sent.description ?? 'send failed' };
    }

    // 存进 LeadReply（用占位文字标识）
    const placeholder = kind === 'photo'
      ? `[图片] ${file.originalname}`
      : kind === 'video'
        ? `[视频] ${file.originalname}`
        : `[文件] ${file.originalname}`;
    await this.leads.addReply(leadId, { sender: 'human', text: placeholder });

    // 广播给房间（带 media metadata 以便 dashboard 渲染缩略图）
    this.gateway.emitMessage(leadId, {
      sender: 'human',
      text: placeholder,
    });

    return { ok: true };
  }
}
