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
import { LeadIntent, LeadStatus } from './lead.entity';
import { LeadsService } from './leads.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';

@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(
    @Query('status') status?: LeadStatus,
    @Query('intent') intent?: LeadIntent,
    @Query('needsHuman') needsHuman?: string,
  ) {
    return this.service.findAll({
      status,
      intent,
      needsHuman: needsHuman !== undefined ? needsHuman === 'true' : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignLeadDto) {
    return this.service.assign(id, dto);
  }

  @Post(':id/note')
  @HttpCode(HttpStatus.OK)
  addNote(@Param('id', ParseUUIDPipe) id: string, @Body('note') note: string) {
    return this.service.addNote(id, note);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
