import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { User, UserRole } from '../auth/user.entity';

export interface CreateUserDto {
  username: string;
  password: string;
  role: UserRole;
  tenantId: string | null;
  enabled?: boolean;
}

export interface UpdateUserDto {
  role?: UserRole;
  tenantId?: string | null;
  enabled?: boolean;
}

/**
 * SUPER_ADMIN 专用：用户 CRUD + 重置密码 + 启用/禁用。
 * 普通 admin 不暴露此能力（避免用户互相提权）。
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: AuthService,
  ) {}

  /** 列用户。可按 tenantId 过滤；不返回 passwordHash/passwordSalt（entity 已 select:false）。 */
  async list(tenantId?: string): Promise<User[]> {
    const qb = this.users.createQueryBuilder('u').orderBy('u.createdAt', 'DESC');
    if (tenantId) qb.where('u.tenantId = :tid', { tid: tenantId });
    return qb.getMany();
  }

  async findOne(id: string): Promise<User> {
    const u = await this.users.findOneBy({ id });
    if (!u) throw new NotFoundException(`User ${id} not found`);
    return u;
  }

  async create(dto: CreateUserDto): Promise<User> {
    if (!dto?.username?.trim()) throw new BadRequestException('username required');
    if (!dto?.password || dto.password.length < 6) {
      throw new BadRequestException('password >= 6 chars required');
    }
    const exists = await this.users.findOneBy({ username: dto.username.trim() });
    if (exists) throw new ConflictException(`username ${dto.username} 已存在`);
    const { passwordHash, passwordSalt } = this.auth.hashPassword(dto.password);
    const user = this.users.create({
      username: dto.username.trim(),
      passwordHash,
      passwordSalt,
      role: dto.role ?? UserRole.OPERATOR,
      tenantId: dto.tenantId ?? null,
      enabled: dto.enabled ?? true,
    });
    return this.users.save(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const u = await this.findOne(id);
    if (dto.role !== undefined) u.role = dto.role;
    if (dto.tenantId !== undefined) u.tenantId = dto.tenantId;
    if (dto.enabled !== undefined) u.enabled = dto.enabled;
    return this.users.save(u);
  }

  /** 管理员重置密码：生成随机 12 位临时密码并返回明文（用户首次登录后应立即改）。 */
  async resetPassword(id: string): Promise<{ tempPassword: string }> {
    const u = await this.findOne(id);
    // 12 chars from a safe alphabet
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const buf = randomBytes(12);
    let temp = '';
    for (let i = 0; i < 12; i++) temp += alphabet[buf[i] % alphabet.length];
    const { passwordHash, passwordSalt } = this.auth.hashPassword(temp);
    u.passwordHash = passwordHash;
    u.passwordSalt = passwordSalt;
    await this.users.save(u);
    return { tempPassword: temp };
  }

  /** 删除用户。不能删自己（callerSub 校验）。 */
  async remove(id: string, callerSub: string): Promise<void> {
    if (id === callerSub) {
      throw new ForbiddenException('不能删除自己当前登录的账号');
    }
    const u = await this.findOne(id);
    await this.users.remove(u);
  }
}
