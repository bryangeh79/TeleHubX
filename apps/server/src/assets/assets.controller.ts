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
import * as fs from 'fs';
import { AllowAgent } from '../auth/roles.decorator';
import { AssetCategory, AssetSource } from './asset.entity';
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
    @Query('source') source?: AssetSource,
    @Query('poolName') poolName?: string,
  ) {
    const tid = await this.resolveTenantId(tenantId);
    return this.service.list(tid, {
      category,
      enabled: enabled === undefined ? undefined : enabled === 'true',
      source,
      poolName,
    });
  }

  /** 列出所有 builtin pool 名 + 各 pool 的素材数（dashboard 侧栏导航用）。 */
  @Get('pools')
  async listPools() {
    return this.service.listBuiltinPools();
  }

  /**
   * Agent 端 media_* executor 调用：随机抽一个 asset 元数据。
   * 优先 poolName；否则 tenant+category；空则回落 builtin 池。
   * 返回 row（不含 content）— agent 拿到 id 后再用 GET /assets/:id/file 拉文件。
   */
  @Get('random')
  @AllowAgent()
  async pickRandom(
    @Query('poolName') poolName?: string,
    @Query('category') category?: AssetCategory,
    @Query('tenantId') tenantId?: string,
  ) {
    const a = await this.service.pickRandomAdvanced({
      tenantId: tenantId ?? null,
      poolName,
      category,
    });
    if (!a) throw new NotFoundException('No asset matches criteria');
    return a;
  }

  @Get(':id')
  @AllowAgent()
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** 下载原始字节（DB bytea 或 builtin 磁盘文件，统一透出）。 */
  @Get(':id/file')
  @AllowAgent()
  async streamFile(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const a = await this.service.findOne(id);

    // builtin / 文件型：直接 stream 磁盘
    if (a.relativePath) {
      const abs = this.service.resolveAbsolutePath(a);
      if (!abs) throw new NotFoundException(`File missing on disk: ${a.relativePath}`);
      res.setHeader('Content-Type', a.mimeType ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(a.byteSize));
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.fileName)}"`);
      fs.createReadStream(abs).pipe(res);
      return;
    }

    // upload 型：DB bytea
    const c = await this.service.getContent(id);
    if (!c) throw new NotFoundException('Asset has no binary content');
    res.setHeader('Content-Type', c.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(c.fileName)}"`);
    res.send(c.buffer);
  }

  /** 老路径保留兼容 */
  @Get(':id/content')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.streamFile(id, res);
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
