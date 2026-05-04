import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auto-Recovery 系统: 给 tasks 表加 3 字段:
 *   - errorClass:     varchar(4) — A/B/D/E/F/G/H 错误分类码
 *   - autoRetryCount: int default 0 — 已自动重试次数
 *   - lastRetryAt:    timestamptz — 上次自动重试时间戳
 *
 * 与 Task entity (apps/server/src/tasks/task.entity.ts) 同步.
 * dev (TYPEORM_SYNC=true) 自动加, prod 需手动跑 `pnpm migration:run`.
 *
 * 红线 (用户要求): 必须用 IF NOT EXISTS, 兼容 dev 已 sync 过的 schema.
 */
export class AddTasksAutoRetryFields1730500000000 implements MigrationInterface {
  name = 'AddTasksAutoRetryFields1730500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "errorClass" VARCHAR(4) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "autoRetryCount" INTEGER NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "lastRetryAt" TIMESTAMP WITH TIME ZONE NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "lastRetryAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "autoRetryCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "errorClass"`,
    );
  }
}
