import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface PgDriverError {
  code?: string;
  detail?: string;
  constraint?: string;
}

@Catch(QueryFailedError)
export class QueryFailedExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(QueryFailedExceptionFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const driver = (exception as unknown as { driverError?: PgDriverError }).driverError ?? {};
    const code = driver.code;

    let mapped: HttpException | null = null;
    switch (code) {
      case '23505':
        mapped = new ConflictException(driver.detail || 'Resource already exists');
        break;
      case '22P02':
        mapped = new BadRequestException('Invalid input format (e.g. malformed UUID)');
        break;
      case '23503':
        mapped = new BadRequestException(driver.detail || 'Referenced resource not found');
        break;
      case '23502':
        mapped = new BadRequestException(driver.detail || 'Required field missing');
        break;
    }

    if (!mapped) {
      this.logger.error(
        `Unmapped DB error code=${code ?? 'unknown'} message=${exception.message}`,
      );
      response.status(500).json({ statusCode: 500, message: 'Internal server error' });
      return;
    }

    const status = mapped.getStatus();
    const body = mapped.getResponse();
    response
      .status(status)
      .json(typeof body === 'string' ? { statusCode: status, message: body, error: mapped.name } : body);
  }
}
