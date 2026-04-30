import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Asset, AssetCategory } from './asset.entity';

const MAX_INLINE_BYTES = 5 * 1024 * 1024; // 5MB before warning, but we accept up to 50MB

function detectCategory(mimetype: string, fileName: string): AssetCategory {
  const m = (mimetype || '').toLowerCase();
  if (m.startsWith('image/')) return AssetCategory.PHOTO;
  if (m.startsWith('video/')) return AssetCategory.VIDEO;
  if (m.startsWith('audio/') || m.includes('ogg') || m.includes('opus')) return AssetCategory.VOICE;
  // 兜底按文件名扩展
  const lower = fileName.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(lower)) return AssetCategory.PHOTO;
  if (/\.(mp4|mov|webm|mkv)$/.test(lower)) return AssetCategory.VIDEO;
  if (/\.(ogg|opus|m4a|mp3|wav)$/.test(lower)) return AssetCategory.VOICE;
  return AssetCategory.DOCUMENT;
}

@Injectable()
export class AssetsService {
  constructor(@InjectRepository(Asset) private readonly repo: Repository<Asset>) {}

  async upload(
    tenantId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    overrides: { category?: AssetCategory; description?: string; tags?: string[] } = {},
  ): Promise<Asset> {
    if (!file) throw new BadRequestException('No file');
    const category = overrides.category ?? detectCategory(file.mimetype, file.originalname);
    const a = this.repo.create({
      tenantId,
      category,
      fileName: file.originalname,
      mimeType: file.mimetype,
      byteSize: file.size,
      content: file.buffer,
      description: overrides.description,
      tags: overrides.tags,
    });
    return this.repo.save(a);
  }

  async createTextSnippet(tenantId: string, text: string, tags?: string[], description?: string): Promise<Asset> {
    if (!text?.trim()) throw new BadRequestException('text 不能为空');
    const a = this.repo.create({
      tenantId,
      category: AssetCategory.TEXT_SNIPPET,
      fileName: text.slice(0, 32) + (text.length > 32 ? '...' : ''),
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(text, 'utf8'),
      textContent: text,
      tags,
      description,
    });
    return this.repo.save(a);
  }

  list(tenantId: string, filters: { category?: AssetCategory; enabled?: boolean } = {}): Promise<Asset[]> {
    const where: FindOptionsWhere<Asset> = { tenantId };
    if (filters.category) where.category = filters.category;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 500 });
  }

  async findOne(id: string): Promise<Asset> {
    const a = await this.repo.findOneBy({ id });
    if (!a) throw new NotFoundException(`Asset ${id} not found`);
    return a;
  }

  /** 返回原始字节（含 select:false 的 content 列） */
  async getContent(id: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null> {
    const a = await this.repo
      .createQueryBuilder('a')
      .addSelect('a.content')
      .where('a.id = :id', { id })
      .getOne();
    if (!a || !a.content) return null;
    return { buffer: a.content, mimeType: a.mimeType ?? 'application/octet-stream', fileName: a.fileName };
  }

  /** 从池中随机抽一个（执行器调用），可按 tenant + category + tags 过滤 */
  async pickRandom(tenantId: string, category: AssetCategory, tagFilter?: string[]): Promise<Asset | null> {
    const list = await this.repo.find({ where: { tenantId, category, enabled: true } });
    let pool = list;
    if (tagFilter?.length) {
      pool = list.filter((a) => a.tags?.some((t) => tagFilter.includes(t)));
    }
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    // 增加使用计数
    await this.repo.increment({ id: pick.id }, 'usageCount', 1);
    return pick;
  }

  async update(id: string, dto: Partial<Asset>): Promise<Asset> {
    const a = await this.findOne(id);
    Object.assign(a, dto);
    return this.repo.save(a);
  }

  async remove(id: string): Promise<void> {
    const a = await this.findOne(id);
    await this.repo.remove(a);
  }
}
