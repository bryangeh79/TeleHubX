import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SlotsService } from './slots.service';

@Controller('slots')
export class SlotsController {
  constructor(private readonly service: SlotsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  /** Operator action: factory-reset a RELEASED slot back to VACANT. */
  @Post(':id/reset')
  @HttpCode(HttpStatus.OK)
  reset(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reset(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
