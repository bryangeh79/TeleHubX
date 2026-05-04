import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Codex round-8: 加 tasks.messageSentAt 字段, 让 campaign_single retry 能跳过已发消息.
 *
 * 与 Task entity (apps/server/src/tasks/task.entity.ts) 同步 — 该字段在 entity 已声明,
 * dev 环境靠 synchronize:true 自动加, prod 关 synchronize 后需要这个 migration.
 *
 * 用 IF NOT EXISTS 保证幂等: dev 环境已自动同步过的 DB 重跑也无害.
 */
export class AddTasksMessageSentAt1730000000000 implements MigrationInterface {
  name = 'AddTasksMessageSentAt1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "messageSentAt" TIMESTAMP WITH TIME ZONE NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "messageSentAt"`,
    );
  }
}
