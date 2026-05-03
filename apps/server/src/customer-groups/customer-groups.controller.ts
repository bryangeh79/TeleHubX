import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { CustomerGroupsService } from './customer-groups.service';
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto';
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto';
import { MemberSource } from './customer-group.entity';

@Controller('customer-groups')
export class CustomerGroupsController {
  constructor(private readonly service: CustomerGroupsService) {}

  @Post()
  create(@Body() dto: CreateCustomerGroupDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('tenantId') tenantId?: string) {
    return this.service.findAll(tenantId);
  }

  /** 候选池预览：给前端筛选时实时反馈人数 */
  @Get('candidate-preview')
  candidatePreview(
    @Query('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('huntTaskId') huntTaskId?: string,
    @Query('minPriorityScore') minPriorityScore?: string,
    @Query('onlyPremium') onlyPremium?: string,
    @Query('activeWithinDays') activeWithinDays?: string,
  ) {
    return this.service.previewCandidates({
      tenantId,
      huntTaskId,
      minPriorityScore: minPriorityScore ? parseInt(minPriorityScore, 10) : undefined,
      onlyPremium: onlyPremium === 'true',
      activeWithinDays: activeWithinDays ? parseInt(activeWithinDays, 10) : undefined,
    });
  }

  /** 列出所有引流任务（带候选数量） */
  @Get('hunt-tasks')
  listHuntTasks(@Query('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.service.listHuntTasks(tenantId);
  }

  /** 从候选池筛选并打包成新客户群 */
  @Post('from-candidates')
  createFromCandidates(@Body() dto: {
    tenantId: string;
    name: string;
    description?: string;
    huntTaskId?: string;
    minPriorityScore?: number;
    onlyPremium?: boolean;
    activeWithinDays?: number;
    limit?: number;
  }) {
    return this.service.createFromCandidates(dto);
  }

  /** 从指定候选人 ID 列表打包成新客户群（前端多选 → 打包） */
  @Post('from-candidate-ids')
  createFromCandidateIds(@Body() dto: {
    tenantId: string;
    name: string;
    description?: string;
    candidateIds: string[];
  }) {
    return this.service.createFromCandidateIds(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerGroupDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }

  /** 追加成员到已有群（去重） */
  @Post(':id/append-members')
  @HttpCode(HttpStatus.OK)
  appendMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { items: Array<{ value: string; source?: MemberSource; huntTaskId?: string; tgUserId?: string; tgUsername?: string; isPremium?: boolean }> },
  ) {
    return this.service.appendMembers(id, body.items ?? []);
  }

  /** 从群里移除某个成员 */
  @Delete(':id/members/:value')
  @HttpCode(HttpStatus.OK)
  removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('value') value: string) {
    return this.service.removeMember(id, decodeURIComponent(value));
  }
}
