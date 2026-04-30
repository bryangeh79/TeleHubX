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
}
