import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * i18n V1 (Issue #1): 加多语言字段, 全部用 IF NOT EXISTS 兼容 dev 已 sync 过的 schema.
 *
 * tenant_settings:
 *   contentDefaultLanguage VARCHAR(8) DEFAULT 'zh'   — 业务内容默认编辑/发布语言
 *   customerReplyLanguage  VARCHAR(8) DEFAULT 'auto' — 客户回复语言 (本轮仅持久化, 主流程未接入)
 *
 * faqs:
 *   language          VARCHAR(8)  DEFAULT 'zh'        — FAQ 语言
 *   status            VARCHAR(16) DEFAULT 'published' — draft / published
 *   translatedFromId  UUID NULL                       — 翻译来源 FAQ id
 *   + INDEX (language, status)
 *
 * knowledge_bases:
 *   language          VARCHAR(8)  DEFAULT 'zh'
 *   status            VARCHAR(16) DEFAULT 'published'
 *   translatedFromId  UUID NULL
 *
 * 红线:
 *   1. 默认 zh / published — 现有数据零行为变化
 *   2. BotGateway / AI 主流程本轮不读这些字段, 仅 dashboard 用
 *   3. 不影响广告投放 / 任务调度 / Auto-Recovery
 */
export class AddI18nFields1730700000000 implements MigrationInterface {
  name = 'AddI18nFields1730700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // tenant_settings
    await queryRunner.query(
      `ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "contentDefaultLanguage" VARCHAR(8) NOT NULL DEFAULT 'zh'`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "customerReplyLanguage" VARCHAR(8) NOT NULL DEFAULT 'auto'`,
    );

    // faqs
    await queryRunner.query(
      `ALTER TABLE "faqs" ADD COLUMN IF NOT EXISTS "language" VARCHAR(8) NOT NULL DEFAULT 'zh'`,
    );
    await queryRunner.query(
      `ALTER TABLE "faqs" ADD COLUMN IF NOT EXISTS "status" VARCHAR(16) NOT NULL DEFAULT 'published'`,
    );
    await queryRunner.query(
      `ALTER TABLE "faqs" ADD COLUMN IF NOT EXISTS "translatedFromId" UUID NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_faqs_language" ON "faqs"("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_faqs_status" ON "faqs"("status")`,
    );

    // knowledge_bases
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "language" VARCHAR(8) NOT NULL DEFAULT 'zh'`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "status" VARCHAR(16) NOT NULL DEFAULT 'published'`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "translatedFromId" UUID NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_faqs_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_faqs_language"`);
    await queryRunner.query(`ALTER TABLE "knowledge_bases" DROP COLUMN IF EXISTS "translatedFromId"`);
    await queryRunner.query(`ALTER TABLE "knowledge_bases" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`ALTER TABLE "knowledge_bases" DROP COLUMN IF EXISTS "language"`);
    await queryRunner.query(`ALTER TABLE "faqs" DROP COLUMN IF EXISTS "translatedFromId"`);
    await queryRunner.query(`ALTER TABLE "faqs" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`ALTER TABLE "faqs" DROP COLUMN IF EXISTS "language"`);
    await queryRunner.query(`ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "customerReplyLanguage"`);
    await queryRunner.query(`ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "contentDefaultLanguage"`);
  }
}
