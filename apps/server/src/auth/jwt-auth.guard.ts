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
      // ?t=<jwt> 仅在白名单路径可用 (媒体下载等不能附 Header 的请求)
      // 防止 query token 被记入 server log / referrer header 泄漏
      const url: string = req.originalUrl || req.url || '';
      const queryTokenAllowed =
        /\/assets\/[^/]+\/file(\?|$)/.test(url) ||
        /\/assets\/[^/]+\/raw(\?|$)/.test(url);
      if (queryTokenAllowed) {
        rawToken = req.query.t;
      }
    }
    if (!rawToken) {
      throw new UnauthorizedException('Authentication required');
    }
    try {
      const payload = this.auth.verifyToken(rawToken);
      req.user = payload;
      return true;
    } catch {
      // 不回 e.message 避免泄漏 (e.g. "jwt expired" / "invalid signature" 区别可被探测)
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
