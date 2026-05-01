import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AssetCategory {
  /** 🖼️ 图片素材池 — MEDIA_PHOTO 任务从这里随机抽 */
  PHOTO = 'photo',
  /** 🎬 视频素材池 — MEDIA_VIDEO */
  VIDEO = 'video',
  /** 🎤 语音素材池 — MEDIA_VOICE (建议 ogg/opus 格式) */
  VOICE = 'voice',
  /** 📁 通用文档（pdf/zip 等）*/
  DOCUMENT = 'document',
  /** 📝 文本片段 — 可作为开场白模板，campaign_single 取用 */
  TEXT_SNIPPET = 'text_snippet',
}

/**
 * 租户素材库 — 按分类组织。
 *
 * 文件存放策略：
 *   - 小文件（< 5MB）直接存 DB 字节字段（方便备份）
 *   - 大文件（视频）建议存 MinIO/S3，DB 只存 URL — 当前 MVP 不分大小都走 DB
 *   - 一旦上传到 TG bot/account，TG 会回 file_id；我们缓存这个 id 之后直接复用
 *     (avoid 反复重新上传同一文件)
 */
export enum AssetSource {
  /** 内置素材库（随安装包分发，所有租户共享） */
  BUILTIN = 'builtin',
  /** 租户上传 */
  UPLOAD = 'upload',
  /** AI 生成（M7 阶段） */
  GENERATED = 'generated',
}

@Entity('assets')
@Index(['tenantId', 'category'])
@Index(['poolName'])
@Index(['source', 'category'])
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** builtin 资源 tenantId 为 null（共享池）。 */
  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ type: 'enum', enum: AssetSource, default: AssetSource.UPLOAD })
  source: AssetSource;

  /**
   * 子池名称，对齐目录层级。
   * 例: '_builtin_images_food' / '_builtin_voices_zh' / 'tenant_xx_promo_2026q2'
   * 任务可以按 poolName 精准抽取（如剧本要求 voices_casual_laugh）。
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  poolName: string | null;

  /**
   * 相对路径（相对项目根 data/ 目录）。
   * builtin 资源一律用此字段；upload 类小文件可省略走 content bytea。
   * 例: 'assets/images/food_general/food_001.jpg'
   */
  @Column({ type: 'varchar', length: 512, nullable: true })
  relativePath: string | null;

  @Column({ type: 'enum', enum: AssetCategory })
  category: AssetCategory;

  /** 文件名（保存原始名便于识别） */
  @Column({ type: 'varchar', length: 256 })
  fileName: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  mimeType: string | null;

  /** 文件大小，字节 */
  @Column({ type: 'int', default: 0 })
  byteSize: number;

  /**
   * 文件二进制（小文件直接存这里）。
   * 大文件请用 storageUrl 指向外部存储（S3/MinIO）。
   */
  @Column({ type: 'bytea', nullable: true, select: false })
  content: Buffer | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  storageUrl: string | null;

  /**
   * TG 上传后返回的 file_id 缓存。
   * 同一个 file_id 后续可直接 sendPhoto({ photo: file_id })，省一次上传。
   * 但 file_id 是 per-bot 绑定的，不同 bot 不能复用。
   * 结构：{ "bot_id_xxx": "AgAC...file_id_str", ... }
   */
  @Column({ type: 'jsonb', nullable: true })
  tgFileIdCache: Record<string, string> | null;

  /** 文本片段类资源直接存这里（其他类型这里为空） */
  @Column({ type: 'text', nullable: true })
  textContent: string | null;

  /** 标签便于分类筛选（"开场白"、"中文"、"产品A"...） */
  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @Column({ default: true })
  enabled: boolean;

  /** 用过几次（统计用） */
  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
