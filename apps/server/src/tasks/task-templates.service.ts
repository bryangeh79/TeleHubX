import { Injectable, Logger, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskTemplate } from './task-template.entity';
import { TaskType } from './task.entity';
import { INDUSTRY_KEYWORD_PACKS } from './industry-keyword-packs';

/**
 * vmfix28 D4: 任务模板 CRUD + 启动时 seed 3 个平台预设模板。
 *
 * 预设模板（用户必看的「快赢」配置）：
 *   1. 「养号期发现群」— 高 minMembers + 启用 sensitive filter, 增量 24h
 *   2. 「营销前发现群」— 低 minMembers + AI expand + multi-account union
 *   3. 「邀请链接挖掘」— discover_groups_by_invites 默认配置
 */
@Injectable()
export class TaskTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(TaskTemplatesService.name);

  constructor(
    @InjectRepository(TaskTemplate)
    private readonly repo: Repository<TaskTemplate>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seedBuiltinTemplates();
    } catch (err: any) {
      this.logger.warn(`seed builtin templates failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Seed 3 平台预设模板（tenantId=null, isBuiltin=true）.
   * 幂等：按 (tenantId=null, name) 检查重复.
   */
  private async seedBuiltinTemplates(): Promise<void> {
    const presets: Array<{
      name: string;
      description: string;
      type: TaskType;
      payload: Record<string, unknown>;
    }> = [
      {
        name: '养号期发现群',
        description: '保守配置 — 适合刚绑的新号。高成员数门槛 + 敏感过滤 + 增量去重，避免乱加 spam 群。',
        type: TaskType.DISCOVER_GROUPS_BY_KEYWORD,
        payload: {
          keywords: [''],
          minMembers: 200,
          sampleSize: 80,
          aiExpand: true,
          useSearchGlobal: true,
          filterSensitive: true,
          incrementalHours: 48,
          multiAccountUnion: false,
          aiScore: false,
          autoJoinAfterDiscover: false,
        },
      },
      {
        name: '营销前发现群',
        description: '激进配置 — 适合已养号成熟、要扩大潜客的场景。AI 扩展 + 多账号 union + 完成后自动加群。',
        type: TaskType.DISCOVER_GROUPS_BY_KEYWORD,
        payload: {
          keywords: [''],
          minMembers: 50,
          sampleSize: 120,
          aiExpand: true,
          useSearchGlobal: true,
          filterSensitive: true,
          incrementalHours: 24,
          multiAccountUnion: true,
          aiScore: true,
          autoJoinAfterDiscover: true,
          autoJoinThreshold: 75,
          autoJoinMax: 3,
        },
      },
      {
        name: '邀请链接挖掘',
        description: '从已加入的种子群扫消息抓 t.me/+xxx 邀请链接。能解锁 contacts.Search 完全搜不到的私密群。',
        type: TaskType.DISCOVER_GROUPS_BY_INVITES,
        payload: {
          seedGroupChatIds: [],
          maxMessagesPerGroup: 500,
          maxLinks: 50,
          filterSensitive: true,
        },
      },
      // vmfix29.1 E2: 5 个行业关键词包，每个一个 builtin 模板
      ...INDUSTRY_KEYWORD_PACKS.map((pack) => ({
        name: `行业包：${pack.displayName}`,
        description: `${pack.description}（共 ${pack.keywords.length} 个关键词，开了 AI 扩展 + 多通道搜 + 自动加群）`,
        type: TaskType.DISCOVER_GROUPS_BY_KEYWORD,
        payload: {
          keywords: pack.keywords,
          minMembers: 50,
          sampleSize: 80,
          aiExpand: true,            // 行业包词已经够多，AI 再扩 6 变体可能太多→关掉？保持开
          useSearchGlobal: true,
          filterSensitive: true,
          incrementalHours: 48,      // 行业包词大量，开长 cache 防风控
          multiAccountUnion: false,
          aiScore: false,
          autoJoinAfterDiscover: false,
          // 内部标记，前端可识别这是行业包
          _industryPack: pack.industry,
        },
      })),
    ];

    let inserted = 0;
    for (const p of presets) {
      const existing = await this.repo.findOne({
        where: { tenantId: null as any, name: p.name },
      });
      if (existing) continue;
      const t = this.repo.create({
        tenantId: null,
        name: p.name,
        description: p.description,
        type: p.type,
        payload: p.payload,
        isBuiltin: true,
        isActive: true,
        usageCount: 0,
      });
      await this.repo.save(t);
      inserted++;
    }
    if (inserted > 0) {
      this.logger.log(`seeded ${inserted} builtin task templates`);
    }
  }

  /** List templates visible to caller (tenant's own + platform builtin) */
  async listForTenant(tenantId: string | null): Promise<TaskTemplate[]> {
    const qb = this.repo.createQueryBuilder('t')
      .where('t."isActive" = true')
      .andWhere('(t."tenantId" IS NULL OR t."tenantId" = :tid)', { tid: tenantId ?? '00000000-0000-0000-0000-000000000000' })
      .orderBy('t."isBuiltin"', 'DESC')  // builtin first
      .addOrderBy('t."usageCount"', 'DESC');
    return qb.getMany();
  }

  async create(
    tenantId: string,
    dto: { name: string; description?: string; type: TaskType; payload: Record<string, unknown> },
  ): Promise<TaskTemplate> {
    const t = this.repo.create({
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type,
      payload: dto.payload,
      isBuiltin: false,
      isActive: true,
      usageCount: 0,
    });
    return this.repo.save(t);
  }

  async incrementUsage(id: string): Promise<void> {
    await this.repo.increment({ id }, 'usageCount', 1);
  }

  async remove(id: string, callerTenantId: string | null): Promise<void> {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException(`TaskTemplate ${id} not found`);
    if (t.isBuiltin) throw new ForbiddenException('平台预设模板不可删除');
    if (t.tenantId !== callerTenantId) throw new ForbiddenException('不可删除其它租户的模板');
    await this.repo.remove(t);
  }
}
