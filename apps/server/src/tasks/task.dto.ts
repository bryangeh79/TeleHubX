import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskStatus, TaskType } from './task.entity';

export class CreateTaskDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsEnum(TaskType)
  type: TaskType;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountLabel?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsDateString()
  scheduledAt: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsString()
  errorMsg?: string | null;

  // Agent 任务退回 pending 时清 startedAt (防 watchdog 拿旧时间误杀)
  @IsOptional()
  startedAt?: string | null;

  // Codex round-8: agent campaignSingle 真消息发送成功后立即标, 防 retry 重发
  @IsOptional()
  messageSentAt?: string | null;

  // Auto-Recovery 系统: 错误分类 + 自动重试计数 (agent 写)
  @IsOptional()
  @IsString()
  @MaxLength(4)
  errorClass?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  autoRetryCount?: number;

  @IsOptional()
  lastRetryAt?: string | null;
}

/**
 * Auto-Recovery: agent 在自动重试前调 POST /tasks/:id/mark-retrying.
 * server 端原子 UPDATE: autoRetryCount, errorClass, lastRetryAt = NOW().
 */
export class MarkRetryingDto {
  @IsString()
  @MaxLength(4)
  errorClass: string;

  @IsInt()
  @Min(1)
  @Max(10)
  count: number;
}
