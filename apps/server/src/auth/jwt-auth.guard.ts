import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * 全局 JWT 守卫。
 *
 * 通过条件：
 *   1. route 上有 @Public() 装饰器 (登录 / health 等)
 *   2. 请求头 Authorization: Bearer <jwt>，token 验签 + 未过期
 *   3. 请求头 X-Agent-Token: <env.AGENT_TOKEN>（agent 端调用回写接口）
 *
 * 通过后：req.user = JwtPayload，没有则抛 401。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly agentToken: string | null;

  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.agentToken = config.get<string>('AGENT_TOKEN') ?? null;
    if (!this.agentToken) {
      this.logger.warn(
        'AGENT_TOKEN not set in env — agent callbacks will be rejected. Set AGENT_TOKEN to a long random string.',
      );
    }
  }

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();

    // Agent token 通道 (用于 agent 回写接口)
    const agentHeader = req.headers['x-agent-token'];
    if (this.agentToken && agentHeader === this.agentToken) {
      req.user = { sub: 'agent', role: 'AGENT', tenantId: null, username: 'agent' };
      return true;
    }

    // JWT 通道
    const authHeader = req.headers.authorization;
    let rawToken: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7);
    } else if (typeof req.query?.t === 'string') {
      // ?t=<jwt> 兼容浏览器 <img src> / <audio src> 这类不能附 Header 的请求
      rawToken = req.query.t;
    }
    if (!rawToken) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    try {
      const payload = this.auth.verifyToken(rawToken);
      req.user = payload;
      return true;
    } catch (e) {
      throw new UnauthorizedException(
        e instanceof Error ? e.message : 'Invalid token',
      );
    }
  }
}
