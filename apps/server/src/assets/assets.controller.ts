import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AssetCategory } from './asset.entity';
import { AssetsService } from './assets.service';
import { TenantsService } from '../tenants/tenants.service';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly service: AssetsService,
    private readonly tenants: TenantsService,
  ) {}

  /** 多 tenant：从 query 拿；省略时用 default tenant */
  private async resolveTenantId(tenantId?: string): Promise<string> {
    if (tenantId) return tenantId;
    const t = await this.tenants.getDefault();
    return t.id;
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { category?: AssetCategory; description?: string; tags?: string; tenantId?: string } = {},
  ) {
    if (!file) throw new BadRequestException('No file uploaded under field "file"');
    const tenantId = await this.resolveTenantId(body.tenantId);
    const tagsArr = body.tags ? body.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    return this.service.upload(tenantId, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    }, { category: body.category, description: body.description, tags: tagsArr });
  }

  @Post('text-snippet')
  async createSnippet(@Body() body: { text: string; tags?: string[]; description?: string; tenantId?: string }) {
    const tenantId = await this.resolveTenantId(body.tenantId);
    return this.service.createTextSnippet(tenantId, body.text, body.tags, body.description);
  }

  @Get()
  async list(
    @Query('category') category?: AssetCategory,
    @Query('enabled') enabled?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const tid = await this.resolveTenantId(tenantId);
    return this.service.list(tid, {
      category,
      enabled: enabled === undefined ? undefined : enabled === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** 下载原始字节 */
  @Get(':id/content')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const c = await this.service.getContent(id);
    if (!c) throw new NotFoundException('Asset has no binary content');
    res.setHeader('Content-Type', c.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(c.fileName)}"`);
    res.send(c.buffer);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
