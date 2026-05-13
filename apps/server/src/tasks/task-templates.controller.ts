import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { TaskTemplatesService } from './task-templates.service';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { callerTenantId, resolveTenantIdSoft } from '../auth/tenant-resolver';
import { TaskType } from './task.entity';

@Controller('task-templates')
export class TaskTemplatesController {
  constructor(private readonly svc: TaskTemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listForTenant(resolveTenantIdSoft(user) ?? null);
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
