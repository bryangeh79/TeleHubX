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
import { ProtectedEntityType } from './kb-protected.entity';
import { KbType } from './kb.entity';
import { KnowledgeService } from './knowledge.service';
import { CreateKbDto, UpdateKbDto } from './dto/create-kb.dto';
import { CreateFaqDto, SearchFaqDto, UpdateFaqDto } from './dto/create-faq.dto';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}

  // === KBs ===

  @Post('kbs')
  createKb(@Body() dto: CreateKbDto) {
    return this.service.createKb(dto);
  }

  @Get('kbs')
  listKbs(
    @Query('type') type?: KbType,
    @Query('enabled') enabled?: string,
  ) {
    return this.service.listKbs({
      type,
      enabled: enabled === undefined ? undefined : enabled === 'true',
    });
  }

  @Get('kbs/:id')
  getKb(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getKb(id);
  }

  @Patch('kbs/:id')
  updateKb(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKbDto) {
    return this.service.updateKb(id, dto);
  }

  @Delete('kbs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeKb(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeKb(id);
  }

  // === FAQs ===

  @Post('faqs')
  createFaq(@Body() dto: CreateFaqDto) {
    return this.service.createFaq(dto);
  }

  @Get('faqs')
  listFaqs(
    @Query('kbId') kbId?: string,
    @Query('enabled') enabled?: string,
  ) {
    return this.service.listFaqs({
      kbId,
      enabled: enabled === undefined ? undefined : enabled === 'true',
    });
  }

  @Get('faqs/:id')
  getFaq(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getFaq(id);
  }

  @Patch('faqs/:id')
  updateFaq(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFaqDto) {
    return this.service.updateFaq(id, dto);
  }

  @Delete('faqs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFaq(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeFaq(id);
  }

  @Post('faqs/bulk-import')
  bulkImport(
    @Body()
    body: {
      kbId: string;
      items: Array<{ question: string; answer: string; tags?: string[] }>;
    },
  ) {
    return this.service.bulkImportFaqs(body.kbId, body.items ?? []);
  }

  @Post('faqs/search')
  @HttpCode(HttpStatus.OK)
  search(@Body() dto: SearchFaqDto) {
    return this.service.search(dto.query, dto.kbId);
  }

  // === Sources (uploaded documents) ===

  @Post('kbs/:id/sources')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadSource(
    @Param('id', ParseUUIDPipe) kbId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded under field "file"');
    return this.service.uploadSource(kbId, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Get('kbs/:id/sources')
  listSources(@Param('id', ParseUUIDPipe) kbId: string) {
    return this.service.listSources(kbId);
  }

  @Delete('kbs/:kbId/sources/:srcId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSource(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('srcId', ParseUUIDPipe) srcId: string,
  ) {
    return this.service.removeSource(srcId);
  }

  // === Protected entities ===

  @Get('kbs/:id/protected')
  listProtected(@Param('id', ParseUUIDPipe) kbId: string) {
    return this.service.listProtected(kbId);
  }

  @Post('kbs/:id/protected')
  addProtected(
    @Param('id', ParseUUIDPipe) kbId: string,
    @Body() body: { entityType: ProtectedEntityType; value: string },
  ) {
    if (!body.value?.trim()) throw new BadRequestException('value is required');
    return this.service.addProtected(kbId, body.entityType, body.value);
  }

  @Delete('kbs/:kbId/protected/:entId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeProtected(
    @Param('kbId', ParseUUIDPipe) _kbId: string,
    @Param('entId', ParseUUIDPipe) entId: string,
  ) {
    return this.service.removeProtected(entId);
  }

  // === AI FAQ generation ===

  @Post('kbs/:id/generate-faqs')
  generateFaqs(
    @Param('id', ParseUUIDPipe) kbId: string,
    @Body() body: { count?: number; sourceIds?: string[] } = {},
  ) {
    return this.service.generateFaqsFromSources(kbId, body);
  }

  /**
   * 为已有 FAQ 反补 var:xxx 变体（升级老 FAQ 进入语义匹配）。
   * force=true 时连已有 variants 也会被重新生成覆盖。
   */
  @Post('kbs/:id/backfill-variants')
  @HttpCode(HttpStatus.OK)
  backfillVariants(
    @Param('id', ParseUUIDPipe) kbId: string,
    @Body() body: { force?: boolean } = {},
  ) {
    return this.service.backfillVariantsForKb(kbId, body);
  }

  /**
   * 从网址提取文字内容（用于公司官网 → 自动填充资料）。
   * 简单 fetch + 去 HTML 标签，适合大部分静态/SSR 官网。
   */
  @Post('extract-url')
  @HttpCode(HttpStatus.OK)
  async extractUrl(@Body() body: { url: string }) {
    if (!body.url?.startsWith('http')) throw new BadRequestException('url 必须以 http 开头');
    try {
      const html = await new Promise<string>((resolve, reject) => {
        const mod = body.url.startsWith('https') ? require('https') : require('http');
        const req = mod.get(body.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TeleHubX/1.0)' } }, (res: any) => {
          // Follow redirect once
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            const rmod = res.headers.location.startsWith('https') ? require('https') : require('http');
            rmod.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2: any) => {
              let d = ''; r2.on('data', (c: any) => { d += c; }); r2.on('end', () => resolve(d));
            }).on('error', reject);
            return;
          }
          let data = '';
          res.on('data', (chunk: any) => { data += chunk; });
          res.on('end', () => resolve(data));
        });
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('超时')); });
        req.on('error', reject);
      });
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 5000);
      return { ok: true, text, length: text.length };
    } catch (err: any) {
      return { ok: false, text: '', error: `无法访问该网址：${err?.message ?? '网络错误'}` };
    }
  }

  /**
   * 产品档案 AI 一键生成：输入产品名 + 文本描述，
   * 返回 overview / features / faq(30-50条) / suggestedGoal。
   * 前端向导第 3 步「AI 生成」按钮调用此接口。
   */
  @Post('ai-generate-product-profile')
  @HttpCode(HttpStatus.OK)
  generateProductProfile(
    @Body() dto: { productName: string; price?: string; rawText: string },
  ) {
    if (!dto.productName?.trim()) throw new BadRequestException('productName 不能为空');
    if (!dto.rawText?.trim()) throw new BadRequestException('rawText 不能为空');
    return this.service.generateProductProfile(dto);
  }

  // === 通用 FAQ（客户闲聊场景，挂在 company KB 下）===

  /** 列出某租户的通用 FAQ（即 company KB 的 FAQ）+ 其 KB 信息 */
  @Get('general-faqs')
  async listGeneralFaqs(@Query('tenantId') tenantId: string) {
    if (!tenantId) throw new BadRequestException('tenantId 必填');
    const kb = await this.service.getCompanyKb(tenantId);
    if (!kb) return { kb: null, faqs: [] };
    const faqs = await this.service.listFaqs({ kbId: kb.id });
    return { kb, faqs };
  }

  /** 确保 company KB 存在，返回 KB（首次打开通用 FAQ 入口时调用） */
  @Post('general-faqs/ensure-kb')
  @HttpCode(HttpStatus.OK)
  ensureCompanyKb(@Body() body: { tenantId: string }) {
    if (!body?.tenantId) throw new BadRequestException('tenantId 必填');
    return this.service.getOrCreateCompanyKb(body.tenantId);
  }

  /** AI 一键生成 N 条闲聊 FAQ，自动入库 */
  @Post('general-faqs/ai-generate')
  @HttpCode(HttpStatus.OK)
  generateGeneralChat(@Body() body: { tenantId: string; count?: number }) {
    if (!body?.tenantId) throw new BadRequestException('tenantId 必填');
    return this.service.generateGeneralChatFaqs(body.tenantId, body.count);
  }
}
