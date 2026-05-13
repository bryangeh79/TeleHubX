import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Asset, AssetCategory, AssetSource } from './asset.entity';
import { getDataPaths } from '../common/paths';

const MAX_INLINE_BYTES = 5 * 1024 * 1024; // 5MB before warning, but we accept up to 50MB

// vmfix20 (Issue #28): SeedPack drops files under data/assets/_builtin/.
// On boot we scan that tree and register any new file as a builtin Asset
// row so the dashboard sees them. Idempotent — files already registered
// (matched by relativePath) are skipped, missing files don't get deleted.
const BUILTIN_DIR_NAME = '_builtin';

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
export class AssetsService implements OnModuleInit {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    @InjectRepository(Asset) private readonly repo: Repository<Asset>,
    private readonly config: ConfigService,
  ) {}

  /**
   * vmfix20 (Issue #28): on boot, scan {dataDir}/assets/_builtin/ and
   * register any new file as a BUILTIN Asset (tenantId=null, shared pool).
   * Files are organized as `_builtin/<poolName>/<filename>`. Files already
   * registered (matched by relativePath) are skipped — fully idempotent.
   *
   * SeedPack installer drops the curated content into this directory.
   * Tenants can also add their own builtin assets by manually copying
   * files to that path.
   */
  async onModuleInit(): Promise<void> {
    try {
      const paths = getDataPaths(this.config);
      const builtinRoot = path.join(paths.root, 'assets', BUILTIN_DIR_NAME);
      if (!fs.existsSync(builtinRoot)) {
        this.logger.log(`assets _builtin directory not present at ${builtinRoot} — skipping seed scan (this is OK if SeedPack not yet installed)`);
        return;
      }
      const found = this.scanBuiltinTree(builtinRoot);
      if (!found.length) {
        this.logger.log(`assets _builtin scan: 0 files found at ${builtinRoot}`);
        return;
      }
      const dataRoot = paths.root;
      let created = 0;
      let skipped = 0;
      for (const file of found) {
        const relativePath = path.relative(dataRoot, file).replace(/\\/g, '/');
        const existing = await this.repo.findOne({
          where: { relativePath, source: AssetSource.BUILTIN },
        });
        if (existing) { skipped++; continue; }
        const stat = fs.statSync(file);
        const fileName = path.basename(file);
        const category = detectCategory('', fileName);
        // Pool name = first directory under _builtin/ (e.g. "images/business_promo")
        const relInsideBuiltin = path.relative(builtinRoot, file).replace(/\\/g, '/');
        const poolName = path.dirname(relInsideBuiltin);
        const a = this.repo.create({
          tenantId: null,
          source: AssetSource.BUILTIN,
          category,
          fileName,
          mimeType: this.guessMimeType(fileName),
          byteSize: stat.size,
          relativePath,                   // points at <dataRoot>/<relativePath>
          poolName: poolName === '.' ? null : poolName,
          enabled: true,
        });
        await this.repo.save(a);
        created++;
      }
      this.logger.log(`assets _builtin scan: ${created} new, ${skipped} already-registered, ${found.length} total on disk`);
    } catch (err: any) {
      // Never let scanner failure block server boot.
      this.logger.error(`assets _builtin scan failed: ${err?.message ?? err}`);
    }
  }

  private scanBuiltinTree(dir: string): string[] {
    const out: string[] = [];
    const stack: string[] = [dir];
    while (stack.length) {
      const cur = stack.pop()!;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        const p = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) out.push(p);
      }
    }
    return out;
  }

  private guessMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
      case '.jpg': case '.jpeg': return 'image/jpeg';
      case '.png':               return 'image/png';
      case '.gif':               return 'image/gif';
      case '.webp':              return 'image/webp';
      case '.mp4':               return 'video/mp4';
      case '.webm':              return 'video/webm';
      case '.mov':               return 'video/quicktime';
      case '.mp3':               return 'audio/mpeg';
      case '.ogg': case '.oga':  return 'audio/ogg';
      case '.opus':              return 'audio/opus';
      case '.m4a':               return 'audio/mp4';
      case '.wav':               return 'audio/wav';
      default:                   return 'application/octet-stream';
    }
  }

  async upload(
    tenantId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    overrides: { category?: AssetCategory; description?: string; tags?: string[]; poolName?: string } = {},
  ): Promise<Asset> {
    if (!file) throw new BadRequestException('No file');
    const category = overrides.category ?? detectCategory(file.mimetype, file.originalname);
    // vmfix28 #4: 支持调用方指定 poolName（ChatScriptEditor 内联上传用）
    // 写入前 sanitize：长度截断 64，去除非常规字符
    const cleanPool = overrides.poolName
      ? overrides.poolName.slice(0, 64).replace(/[\s]+/g, '_')
      : null;
    const a = this.repo.create({
      tenantId,
      category,
      poolName: cleanPool,
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

  list(
    tenantId: string,
    filters: { category?: AssetCategory; enabled?: boolean; source?: AssetSource; poolName?: string } = {},
  ): Promise<Asset[]> {
    const where: FindOptionsWhere<Asset> = {};
    // source=builtin 时忽略 tenantId（共享池），否则限定 tenantId
    if (filters.source === AssetSource.BUILTIN) {
      where.source = AssetSource.BUILTIN;
      where.tenantId = IsNull();
    } else {
      where.tenantId = tenantId;
      if (filters.source) where.source = filters.source;
    }
    if (filters.category) where.category = filters.category;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
    if (filters.poolName) where.poolName = filters.poolName;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 1000 });
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

  /**
   * 高级随机抽取（agent 端 media_* 任务调用）。
   * 优先级：先按 poolName，没有则按 tenantId+category，最后回落到 builtin 池。
   */
  async pickRandomAdvanced(opts: {
    tenantId?: string | null;
    poolName?: string;
    category?: AssetCategory;
  }): Promise<Asset | null> {
    const where: FindOptionsWhere<Asset> = { enabled: true };
    if (opts.poolName) {
      where.poolName = opts.poolName;
    } else {
      if (opts.tenantId) where.tenantId = opts.tenantId;
      if (opts.category) where.category = opts.category;
    }
    let list = await this.repo.find({ where });
    // 回退：tenant 自有池为空 → 用 builtin 池
    if (!list.length && opts.category) {
      list = await this.repo.find({
        where: { source: AssetSource.BUILTIN, category: opts.category, enabled: true, tenantId: IsNull() },
      });
    }
    if (!list.length) return null;
    const pick = list[Math.floor(Math.random() * list.length)];
    await this.repo.increment({ id: pick.id }, 'usageCount', 1);
    return pick;
  }

  /** 列出所有 builtin pool 名 + 每个 pool 内素材数 + 类型。 */
  async listBuiltinPools(): Promise<Array<{ poolName: string; category: AssetCategory; count: number }>> {
    const rows = await this.repo
      .createQueryBuilder('a')
      .select('a.poolName', 'poolName')
      .addSelect('a.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('a.source = :s', { s: AssetSource.BUILTIN })
      .andWhere('a.poolName IS NOT NULL')
      .groupBy('a.poolName')
      .addGroupBy('a.category')
      .orderBy('a.poolName', 'ASC')
      .getRawMany();
    return rows.map((r) => ({
      poolName: r.poolName,
      category: r.category,
      count: parseInt(r.count, 10),
    }));
  }

  /** 解析 builtin 资源的磁盘绝对路径；upload 资源读 bytea。 */
  resolveAbsolutePath(asset: Asset): string | null {
    if (!asset.relativePath) return null;
    // vmfix20 (Issue #28): use canonical data dir from getDataPaths(),
    // not __dirname-derived PROJECT_ROOT which broke under Windows
    // installer (where dataDir is %ProgramData%\TeleHubX\data, not
    // <appDir>/data).
    const dataRoot = getDataPaths(this.config).root;
    const abs = path.join(dataRoot, asset.relativePath);
    if (!fs.existsSync(abs)) return null;
    return abs;
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
