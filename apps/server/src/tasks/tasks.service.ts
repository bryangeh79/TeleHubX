import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { CreateTaskDto, UpdateTaskDto } from './task.dto';
import { Task, TaskStatus, TaskType } from './task.entity';

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
  ) {}

  create(dto: CreateTaskDto, tenantId?: string): Promise<Task> {
    const task = this.repo.create({
      ...dto,
      scheduledAt: new Date(dto.scheduledAt),
      tenantId: tenantId ?? null,
      status: TaskStatus.PENDING,
      progress: 0,
    });
    return this.repo.save(task);
  }

  findAll(filters: { status?: TaskStatus; type?: TaskType; tenantId?: string } = {}): Promise<Task[]> {
    const where: FindOptionsWhere<Task> = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    return this.repo.find({ where, order: { scheduledAt: 'ASC' }, take: 500 });
  }

  async findOne(id: string): Promise<Task> {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException(`Task ${id} not found`);
    return t;
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const t = await this.findOne(id);
    if (dto.scheduledAt) {
      t.scheduledAt = new Date(dto.scheduledAt);
    }
    if (dto.name !== undefined) t.name = dto.name;
    if (dto.status !== undefined) t.status = dto.status;
    if (dto.payload !== undefined) t.payload = dto.payload;
    if (dto.progress !== undefined) t.progress = dto.progress;
    if (dto.errorMsg !== undefined) t.errorMsg = dto.errorMsg;
    return this.repo.save(t);
  }

  async pause(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.RUNNING) return t;
    t.status = TaskStatus.PAUSED;
    return this.repo.save(t);
  }

  async resume(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.PAUSED) return t;
    t.status = TaskStatus.RUNNING;
    return this.repo.save(t);
  }

  async retry(id: string): Promise<Task> {
    const t = await this.findOne(id);
    if (t.status !== TaskStatus.FAILED) return t;
    t.status = TaskStatus.PENDING;
    t.errorMsg = null;
    t.progress = 0;
    t.startedAt = null;
    t.finishedAt = null;
    return this.repo.save(t);
  }

  async remove(id: string): Promise<void> {
    const t = await this.findOne(id);
    await this.repo.remove(t);
  }

  async stats(tenantId?: string): Promise<{ total: number; pending: number; running: number; failed: number; done: number }> {
    const where: FindOptionsWhere<Task> = {};
    if (tenantId) where.tenantId = tenantId;
    const all = await this.repo.find({ where, take: 5000 });
    return {
      total:   all.length,
      pending: all.filter((t) => t.status === TaskStatus.PENDING).length,
      running: all.filter((t) => t.status === TaskStatus.RUNNING).length,
      failed:  all.filter((t) => t.status === TaskStatus.FAILED).length,
      done:    all.filter((t) => t.status === TaskStatus.DONE).length,
    };
  }
}
