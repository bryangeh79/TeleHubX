import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { username: string; password: string }) {
    return this.service.login(body.username, body.password);
  }

  @Get('me')
  me(@Headers('authorization') auth?: string) {
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const payload = this.service.verifyToken(auth.slice(7));
    return this.service.me(payload.sub);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Headers('authorization') auth: string,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const payload = this.service.verifyToken(auth.slice(7));
    await this.service.changePassword(payload.sub, body.oldPassword, body.newPassword);
    return { ok: true };
  }
}
