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
import { KbType } from './kb.entity';
import { KnowledgeService } from './knowledge.service';
import { CreateKbDto, UpdateKbDto } from './dto/create-kb.dto';
import { CreateFaqDto, SearchFaqDto, UpdateFaqDto } from './dto/create-faq.dto';

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
}
