import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { TenantsService } from '../tenants/tenants.service';
import { User, UserRole } from './user.entity';

const SCRYPT_KEYLEN = 64;

interface JwtPayload {
  sub: string;        // user id
  username: string;
  role: UserRole;
  tenantId: string | null;
  iat: number;        // issued at (sec)
  exp: number;        // expires at (sec)
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string;
  private readonly tokenTtlSeconds: number;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
    private readonly tenants: TenantsService,
  ) {
    const explicitSecret =
      this.config.get<string>('JWT_SECRET') ??
      this.config.get<string>('SESSION_ENCRYPTION_KEY');
    const isProd = (this.config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production';
    if (isProd && !explicitSecret) {
      // 生产环境必须显式配置密钥，否则用默认值等于把所有用户 token 暴露给已知字符串
      throw new Error(
        'FATAL: JWT_SECRET (or SESSION_ENCRYPTION_KEY) must be set in production. Refusing to start.',
      );
    }
    this.jwtSecret = explicitSecret ?? 'telehubx-dev-jwt-secret-CHANGE-ME';
    this.tokenTtlSeconds = parseInt(
      this.config.get<string>('JWT_EXPIRES_SEC', '604800'), // 7 days
      10,
    );
  }

  /**
   * Bootstrap a default admin/admin user on first run so the LoginPage
   * has someone to authenticate as. Production should change the
   * password immediately. The presence of this user is a strong signal
   * the deployment has not been hardened yet.
   */
  async onModuleInit(): Promise<void> {
    const isProd = (this.config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production';
    if (isProd) {
      // 生产环境绝不自动创建 admin/admin — 必须由运维显式 seed
      return;
    }
    const existing = await this.users.findOneBy({ username: 'admin' });
    if (!existing) {
      const tenant = await this.tenants.getDefault().catch(() => null);
      const { passwordHash, passwordSalt } = this.hashPassword('admin');
      const user = this.users.create({
        username: 'admin',
        passwordHash,
        passwordSalt,
        role: UserRole.SUPER_ADMIN,
        tenantId: tenant?.id ?? null,
      });
      await this.users.save(user);
      this.logger.warn(
        'Bootstrapped default admin/admin user — change password ASAP via POST /auth/change-password',
      );
    }
  }

  // === Password hashing (scrypt — built into Node, no bcrypt dep needed) ===

  private hashPassword(password: string): { passwordHash: string; passwordSalt: string } {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
    return { passwordHash: hash, passwordSalt: salt };
  }

  private verifyPassword(password: string, salt: string, expectedHash: string): boolean {
    const got = scryptSync(password, salt, SCRYPT_KEYLEN);
    const want = Buffer.from(expectedHash, 'hex');
    if (got.length !== want.length) return false;
    return timingSafeEqual(got, want);
  }

  // === Hand-rolled HS256 JWT (avoid adding @nestjs/jwt as a dep) ===

  private base64UrlEncode(input: Buffer | string): string {
    const buf = typeof input === 'string' ? Buffer.from(input) : input;
    return buf
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private base64UrlDecode(input: string): Buffer {
    const pad = (4 - (input.length % 4)) % 4;
    const normalized = (input + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64');
  }

  private signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
    const now = Math.floor(Date.now() / 1000);
    const full: JwtPayload = { ...payload, iat: now, exp: now + this.tokenTtlSeconds };
    const headerB64 = this.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payloadB64 = this.base64UrlEncode(JSON.stringify(full));
    const sig = createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    return `${headerB64}.${payloadB64}.${this.base64UrlEncode(sig)}`;
  }

  verifyToken(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed token');
    const [headerB64, payloadB64, sigB64] = parts;
    const expectedSig = createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const got = this.base64UrlDecode(sigB64);
    if (got.length !== expectedSig.length || !timingSafeEqual(got, expectedSig)) {
      throw new UnauthorizedException('Invalid signature');
    }
    const payload = JSON.parse(this.base64UrlDecode(payloadB64).toString('utf-8')) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }
    return payload;
  }

  // === Public API ===

  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: { id: string; username: string; role: UserRole; tenantId: string | null } }> {
    const user = await this.users.findOne({
      where: { username },
      select: ['id', 'username', 'passwordHash', 'passwordSalt', 'role', 'tenantId', 'enabled'],
    });
    if (!user || !user.enabled) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!this.verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    user.lastLoginAt = new Date();
    await this.users.update(user.id, { lastLoginAt: user.lastLoginAt });

    const token = this.signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    });
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async me(userId: string): Promise<User> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  async changePassword(userId: string, oldPw: string, newPw: string): Promise<void> {
    if (!newPw || newPw.length < 6) {
      throw new BadRequestException('New password must be at least 6 chars');
    }
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'passwordHash', 'passwordSalt'],
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (!this.verifyPassword(oldPw, user.passwordSalt, user.passwordHash)) {
      throw new UnauthorizedException('Old password incorrect');
    }
    const fresh = this.hashPassword(newPw);
    await this.users.update(userId, fresh);
  }
}
