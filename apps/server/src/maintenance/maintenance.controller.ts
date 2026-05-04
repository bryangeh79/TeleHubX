import { Controller, Get, Logger, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, isSuperAdmin } from '../auth/current-user.decorator';
import { Account, AccountStatus } from '../accounts/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { BotReplyService } from '../bot-gateway/bot-reply.service';
import { Proxy, ProxyStatus } from '../proxies/proxy.entity';
import { ProxiesService } from '../proxies/proxies.service';
import { Task, TaskStatus } from '../tasks/task.entity';
import { TenantBot } from '../tenants/tenant-bot.entity';
import { TenantsService } from '../tenants/tenants.service';

/**
 * 租户自助诊断面板的后端聚合接口。
 *
 * 设计原则：
 *   - 所有端点按 caller 的 tenantId 过滤（super_admin 看所有）
 *   - 只读 + 测试操作；不做修改/重启（修改性操作走各自资源的 controller）
 *   - 每个端点单独检查，前端按需懒加载，不一次拉所有数据
 */
@Controller('maintenance')
export class MaintenanceController {
  private readonly logger = new Logger(MaintenanceController.name);

  constructor(
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
    @InjectRepository(TenantBot) private readonly botRepo: Repository<TenantBot>,
    @InjectRepository(Proxy) private readonly proxyRepo: Repository<Proxy>,
    @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
    private readonly accounts: AccountsService,
    private readonly proxies: ProxiesService,
    private readonly tenants: TenantsService,
    private readonly botReply: BotReplyService,
  ) {}

  /** 当前调用者可见的 tenantId（super_admin 返回 null = 看所有） */
  private callerTenantId(user: AuthUser): string | null {
    if (isSuperAdmin(user)) return null;
    return user.tenantId ?? null;
  }

  /**
   * M1: 账号健康一键体检
   * 返回租户范围内：总数 / 红黄绿数 / 平均分 / 列出 health<60 的异常账号
   */
  @Get('accounts/diagnose')
  async diagnoseAccounts(@CurrentUser() user: AuthUser) {
    const tid = this.callerTenantId(user);
    const qb = this.accountRepo.createQueryBuilder('a');
    if (tid) qb.where('a."tenantId" = :tid', { tid });
    const all = await qb.getMany();

    const stats = { total: all.length, healthy: 0, warning: 0, caution: 0, critical: 0, avgScore: 0 };
    let sum = 0;
    const problems: Array<{
      id: string; phoneNumber: string; status: string;
      healthScore: number; lastSeenAt: string | null; reason: string;
    }> = [];
    for (const a of all) {
      sum += a.healthScore;
      if (a.healthScore >= 80) stats.healthy++;
      else if (a.healthScore >= 60) stats.warning++;
      else if (a.healthScore >= 30) stats.caution++;
      else stats.critical++;

      // 问题账号判定：低分 / banned / error / 长时间未上线
      const reasons: string[] = [];
      if (a.healthScore < 60) reasons.push(`health=${a.healthScore}`);
      if (a.status === AccountStatus.BANNED) reasons.push('已封禁');
      if (a.status === AccountStatus.ERROR) reasons.push('错误状态');
      if (a.lastActiveAt) {
        const ageHrs = (Date.now() - new Date(a.lastActiveAt).getTime()) / 3_600_000;
        if (ageHrs > 24) reasons.push(`${Math.floor(ageHrs / 24)}天未上线`);
      } else if (!a.sessionEncrypted) {
        reasons.push('未登录');
      }
      if (reasons.length) {
        problems.push({
          id: a.id,
          phoneNumber: a.phoneNumber,
          status: a.status,
          healthScore: a.healthScore,
          lastSeenAt: a.lastActiveAt ? a.lastActiveAt.toISOString() : null,
          reason: reasons.join(' / '),
        });
      }
    }
    stats.avgScore = all.length ? Math.round(sum / all.length) : 0;
    return { stats, problems };
  }

  /**
   * M2: Bot 长轮询自检
   * 对每个租户 bot 调一次 TG getMe，返回 token 是否有效 + 最后轮询时间
   */
  @Get('bots/diagnose')
  async diagnoseBots(@CurrentUser() user: AuthUser) {
    const tid = this.callerTenantId(user);
    const qb = this.botRepo.createQueryBuilder('b');
    if (tid) qb.where('b."tenantId" = :tid', { tid });
    const bots = await qb.getMany();

    const out: Array<{
      id: string; tenantId: string | null; botUsername: string | null;
      isActive: boolean; lastPollAt: string | null; pollAgeSec: number | null;
      tokenOk: boolean; tokenError?: string;
    }> = [];

    for (const b of bots) {
      const item: any = {
        id: b.id,
        tenantId: b.tenantId,
        botUsername: b.botUsername ?? null,
        isActive: b.isActive,
        lastPollAt: b.lastPollAt ? b.lastPollAt.toISOString() : null,
        pollAgeSec: b.lastPollAt ? Math.floor((Date.now() - b.lastPollAt.getTime()) / 1000) : null,
        tokenOk: false,
      };
      try {
        const withToken = await this.tenants.findBotWithToken(b.id);
        const me = await this.botReply.getMe(withToken.rawToken);
        item.tokenOk = !!me?.id;
      } catch (err: any) {
        item.tokenError = err?.message ?? 'getMe 失败';
      }
      out.push(item);
    }
    return { total: out.length, bots: out };
  }

  /**
   * M4: 代理健康自检
   * 列租户范围内的所有代理 + 当前 status；可单点重测 → 走 /proxies/:id/test
   * 这里只做静态汇总，避免一键测引发风暴（用户在 ProxiesPage 单点重测）
   */
  @Get('proxies/diagnose')
  async diagnoseProxies(@CurrentUser() user: AuthUser) {
    const tid = this.callerTenantId(user);
    const qb = this.proxyRepo.createQueryBuilder('p').orderBy('p.status', 'ASC').addOrderBy('p.createdAt', 'DESC');
    // proxies 当前没有 tenantId 字段，全平台共享 → 不按 tenant 过滤
    // (CLAUDE.md 已记此为有意设计)
    if (tid && this.proxyHasTenantField()) qb.where('p."tenantId" = :tid', { tid });
    const all = await qb.getMany();

    const stats = { total: all.length, active: 0, dead: 0, disabled: 0 };
    const problems: Array<{ id: string; host: string; port: number; status: string; lastError: string | null; lastTestedAt: string | null }> = [];
    for (const p of all) {
      if (p.status === ProxyStatus.ACTIVE) stats.active++;
      else if (p.status === ProxyStatus.DEAD) stats.dead++;
      else stats.disabled++;
      if (p.status !== ProxyStatus.ACTIVE) {
        problems.push({
          id: p.id,
          host: p.host,
          port: p.port,
          status: p.status,
          lastError: (p as any).lastError ?? null,
          lastTestedAt: (p as any).lastTestedAt
            ? new Date((p as any).lastTestedAt).toISOString()
            : null,
        });
      }
    }
    return { stats, problems };
  }

  private proxyHasTenantField(): boolean {
    return false;
  }

  /**
   * M5: 失败任务诊断
   * 最近 N 天 failed 任务按 errorMsg 前缀聚合（去 ID/数字噪音）
   */
  @Get('tasks/failure-summary')
  async failureSummary(
    @CurrentUser() user: AuthUser,
    @Query('days') daysStr?: string,
  ) {
    const tid = this.callerTenantId(user);
    const days = Math.min(30, Math.max(1, parseInt(daysStr ?? '7', 10)));
    const since = new Date(Date.now() - days * 86400_000);
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.status = :s', { s: TaskStatus.FAILED })
      .andWhere('t.finishedAt >= :since', { since })
      .orderBy('t.finishedAt', 'DESC');
    if (tid) qb.andWhere('t."tenantId" = :tid', { tid });
    const all = await qb.limit(500).getMany();

    // errorMsg 归一化：取前 80 字 + 去掉 UUID/纯数字/时间戳碎片以便聚类
    const buckets = new Map<string, { count: number; sample: string; types: Set<string>; latest: string }>();
    for (const t of all) {
      const raw = (t.errorMsg ?? '(无错误信息)').slice(0, 200);
      const key = raw
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
        .replace(/\b\d{6,}\b/g, '<num>')
        .replace(/\d+ms/g, '<ms>')
        .slice(0, 80);
      const b = buckets.get(key);
      if (b) {
        b.count++;
        b.types.add(t.type);
        if (t.finishedAt && new Date(t.finishedAt).toISOString() > b.latest) {
          b.latest = new Date(t.finishedAt).toISOString();
        }
      } else {
        buckets.set(key, {
          count: 1,
          sample: raw,
          types: new Set([t.type]),
          latest: t.finishedAt ? new Date(t.finishedAt).toISOString() : new Date().toISOString(),
        });
      }
    }
    const summary = Array.from(buckets.entries())
      .map(([key, v]) => ({
        errorPattern: key,
        count: v.count,
        sample: v.sample,
        taskTypes: Array.from(v.types),
        latest: v.latest,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return { days, totalFailed: all.length, summary };
  }
}
