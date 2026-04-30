import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CandidateStatus } from './lead-candidate.entity';
import { BulkUpsertItem, LeadCandidatesService } from './leads-candidates.service';

@Controller('lead-candidates')
export class LeadCandidatesController {
  constructor(private readonly service: LeadCandidatesService) {}

  /**
   * agent 群成员爬取专用：批量写入候选池。
   * body: { tenantId, items: BulkUpsertItem[] }
   */
  @Post('bulk-upsert')
  bulkUpsert(@Body() body: { tenantId: string; items: BulkUpsertItem[] }) {
    return this.service.bulkUpsert(body.tenantId, body.items ?? []);
  }

  @Get('pending')
  listPending(@Query('tenantId') tenantId: string, @Query('limit') limit?: string) {
    return this.service.listPending(tenantId, limit ? parseInt(limit, 10) : 50);
  }

  @Get()
  findAll(@Query('tenantId') tenantId: string, @Query('status') status?: CandidateStatus) {
    return this.service.findAll(tenantId, status);
  }

  @Get('stats')
  stats(@Query('tenantId') tenantId: string) {
    return this.service.stats(tenantId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** 标记已联系（agent 触达完成后回写）。 */
  @Post(':id/mark-contacted')
  markContacted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { contactedByAccountId: string; contactTaskId?: string },
  ) {
    return this.service.markContacted(id, body.contactedByAccountId, body.contactTaskId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
