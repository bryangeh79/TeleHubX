import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CloudLicenseError } from './cloud-license-client';
import { CloudLicenseService } from './cloud-license.service';

@Controller('cloud-license')
export class CloudLicenseController {
  constructor(private readonly service: CloudLicenseService) {}

  /** Public: needed before login (admin user creation requires unlock). */
  @Public()
  @Get('status')
  status() {
    return this.service.status();
  }

  /**
   * Public: first-run setup. Pasted from the customer's onboarding email.
   * Once activated, the agent token + plan + maxAccounts are persisted
   * locally (encrypted) and reused across restarts.
   */
  @Public()
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  async activate(@Body() body: { licenseKey?: string }) {
    const key = String(body?.licenseKey ?? '').trim();
    if (!key.startsWith('THX-')) {
      throw new BadRequestException('License key must start with THX-');
    }
    try {
      return await this.service.activate(key);
    } catch (err) {
      if (err instanceof CloudLicenseError) {
        // Map worker error codes to HTTP status. machine_mismatch → 409 etc.
        if (err.httpStatus >= 400 && err.httpStatus < 500) {
          throw new BadRequestException({ code: err.code, message: err.message });
        }
        throw new InternalServerErrorException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }

  /** Authenticated: trigger an immediate /license/verify call. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh() {
    return this.service.refresh();
  }
}
