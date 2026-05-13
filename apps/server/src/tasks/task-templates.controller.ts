import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { TaskTemplatesService } from './task-templates.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { callerTenantId, resolveTenantIdSoft } from '../auth/tenant-resolver';
import { TaskType } from './task.entity';
import { INDUSTRY_KEYWORD_PACKS, listIndustries } from './industry-keyword-packs';

@Controller('task-templates')
export class TaskTemplatesController {
  constructor(private readonly svc: TaskTemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listForTenant(resolveTenantIdSoft(user) ?? null);
  }

  /** vmfix29.1 E2: 列出 5 个行业关键词包（不需要 auth — 信息性资源）*/
  @Get('industry-packs')
  listIndustryPacks() {
    return listIndustries();
  }

  /** vmfix29.1 E2: 拉取某个行业的关键词数组（前端「应用行业包」按钮用）*/
  @Get('industry-packs/:industry')
  getIndustryPack(@Param('industry') industry: string) {
    const pack = INDUSTRY_KEYWORD_PACKS.find((p) => p.industry === industry);
    if (!pack) return { keywords: [], notFound: true };
    return {
      industry: pack.industry,
      displayName: pack.displayName,
      description: pack.description,
      keywords: pack.keywords,
      count: pack.keywords.length,
    };
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: { name: string; description?: string; type: TaskType; payload: Record<string, unknown> },
  ) {
    const tenantId = callerTenantId(user);
    if (!tenantId) throw new Error('tenant required');
    return this.svc.create(tenantId, body);
  }

  @Post(':id/used')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markUsed(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.incrementUsage(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(id, callerTenantId(user));
  }
}
