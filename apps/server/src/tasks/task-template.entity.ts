import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaskType } from './task.entity';

/**
 * vmfix28 D4: 任务模板系统。
 *
 * 用途：把常用 task payload 存成可复用模板，租户在新建任务时「从模板创建」一键预填表单。
 *
 * - `tenantId=null` 的是平台预设（onModuleInit 自动 seed），不可被租户删
 * - 租户可创建自己的模板（tenantId 非 null），只对自己 tenant 可见
 * - 模板只存 type + payload + name/description，不存 accountId（运行时再选）
 */
@Entity('task_templates')
@Index(['tenantId', 'isActive'])
export class TaskTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** null = 平台预设（所有租户可见 + 不可删）；非 null = 该租户自有模板 */
  @Column({ type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: TaskType })
  type: TaskType;

  /** task.payload 的预设值；用户「从模板创建」时会 spread 到新 task.payload */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /** true = 平台预设，不可删（DELETE 端点拦截） */
  @Column({ type: 'boolean', default: false })
  isBuiltin: boolean;

  /** true = 启用 */
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** 累计使用次数（每次"从模板创建任务"+1，用于推荐排序） */
  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
