import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { In } from 'typeorm';
import { TasksService } from '../tasks/tasks.service';
import { TaskType } from '../tasks/task.entity';
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
    private readonly tasks: TasksService,
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
   * M5: 失败任务诊断 — 按根因分类
   *
   * 不只是 errorMsg 文本聚类，还按错误类别归一（network_timeout / flood_wait /
   * entity_not_found / agent_offline / business_zero / config / unknown），
   * 让租户能针对性修复而不是看到一堆 "任务超时" 摸不着头脑。
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
    const all = await qb.limit(1000).getMany();

    interface Bucket {
      bucketId: string;
      category: ErrorCategory;
      categoryLabel: string;
      taskIds: string[];           // 让前端能一键重试本聚类全部
      count: number;
      sample: string;
      taskTypes: Set<string>;
      latest: string;
      hint: string;                // 修复建议（前端展示）
      retryable: boolean;          // 重试是否大概率有用
    }
    const buckets = new Map<string, Bucket>();

    for (const t of all) {
      const raw = (t.errorMsg ?? '(无错误信息)').slice(0, 300);
      const cat = classifyError(raw, t.type);
      // 同 category + (errorMsg 前 50 字归一) 视为一个 bucket
      const norm = raw
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
        .replace(/\b\d{6,}\b/g, '<num>')
        .replace(/\d+ms/g, '<ms>')
        .replace(/@\w+/g, '<user>')
        .slice(0, 60);
      const bucketId = `${cat.category}::${norm}`;
      const b = buckets.get(bucketId);
      if (b) {
        b.count++;
        b.taskIds.push(t.id);
        b.taskTypes.add(t.type);
        if (t.finishedAt && new Date(t.finishedAt).toISOString() > b.latest) {
          b.latest = new Date(t.finishedAt).toISOString();
        }
      } else {
        buckets.set(bucketId, {
          bucketId,
          category: cat.category,
          categoryLabel: cat.label,
          taskIds: [t.id],
          count: 1,
          sample: raw,
          taskTypes: new Set([t.type]),
          latest: t.finishedAt ? new Date(t.finishedAt).toISOString() : new Date().toISOString(),
          hint: cat.hint,
          retryable: cat.retryable,
        });
      }
    }
    const summary = Array.from(buckets.values())
      .map((v) => ({
        bucketId: v.bucketId,
        category: v.category,
        categoryLabel: v.categoryLabel,
        count: v.count,
        sample: v.sample,
        taskTypes: Array.from(v.taskTypes),
        latest: v.latest,
        hint: v.hint,
        retryable: v.retryable,
        // 限制返回的 taskIds 数量避免 payload 过大；retry-bucket 端点重新查
        sampleTaskIds: v.taskIds.slice(0, 5),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    // 按 category 二次聚合（顶部 KPI 显示）
    const byCategory: Record<string, number> = {};
    for (const s of summary) byCategory[s.category] = (byCategory[s.category] ?? 0) + s.count;

    return { days, totalFailed: all.length, summary, byCategory };
  }

  /**
   * 一键重试某个 bucket 下的全部失败任务。
   * 客户端传 bucketId（与 summary 里的相同），后端重新查 days 范围内匹配该
   * bucket 的所有 failed task → 逐个走 tasks.retry。
   *
   * retryable=false 的 bucket（业务零结果 / 配置错）应该被前端禁用，
   * 但后端仍允许调用（用户可能强制重试）。
   */
  @Post('tasks/retry-bucket')
  @HttpCode(HttpStatus.OK)
  async retryBucket(
    @CurrentUser() user: AuthUser,
    @Body() body: { bucketId: string; days?: number },
  ) {
    if (!body?.bucketId) return { retried: 0, error: 'bucketId required' };
    const tid = this.callerTenantId(user);
    const days = Math.min(30, Math.max(1, body.days ?? 7));
    const since = new Date(Date.now() - days * 86400_000);
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.status = :s', { s: TaskStatus.FAILED })
      .andWhere('t.finishedAt >= :since', { since });
    if (tid) qb.andWhere('t."tenantId" = :tid', { tid });
    const all = await qb.limit(1000).getMany();

    // 重新计算 bucketId 匹配
    const matched: string[] = [];
    for (const t of all) {
      const raw = (t.errorMsg ?? '(无错误信息)').slice(0, 300);
      const cat = classifyError(raw, t.type);
      const norm = raw
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
        .replace(/\b\d{6,}\b/g, '<num>')
        .replace(/\d+ms/g, '<ms>')
        .replace(/@\w+/g, '<user>')
        .slice(0, 60);
      if (`${cat.category}::${norm}` === body.bucketId) matched.push(t.id);
    }

    let retried = 0;
    const errors: string[] = [];
    for (const id of matched) {
      try {
        await this.tasks.retry(id);
        retried++;
      } catch (err: any) {
        errors.push(`${id.slice(0, 8)}: ${err?.message ?? String(err)}`);
      }
    }
    this.logger.log(`retry-bucket ${body.bucketId.slice(0, 40)}... → ${retried}/${matched.length} 重试`);
    return { retried, totalMatched: matched.length, errors: errors.slice(0, 5) };
  }

  /**
   * 删除某个 bucket 下的全部 failed 任务记录（清理噪音）。
   * 用于 entity_not_found / business_zero 这类没法自动修但反复出现的，
   * 让租户能"清理"诊断面板。删除是软删（仅从 tasks 表移除，不影响 leads 等下游）。
   */
  @Post('tasks/dismiss-bucket')
  @HttpCode(HttpStatus.OK)
  async dismissBucket(
    @CurrentUser() user: AuthUser,
    @Body() body: { bucketId: string; days?: number },
  ) {
    if (!body?.bucketId) return { dismissed: 0 };
    const tid = this.callerTenantId(user);
    const days = Math.min(30, Math.max(1, body.days ?? 7));
    const since = new Date(Date.now() - days * 86400_000);
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.status = :s', { s: TaskStatus.FAILED })
      .andWhere('t.finishedAt >= :since', { since });
    if (tid) qb.andWhere('t."tenantId" = :tid', { tid });
    const all = await qb.limit(1000).getMany();

    const matched: string[] = [];
    for (const t of all) {
      const raw = (t.errorMsg ?? '(无错误信息)').slice(0, 300);
      const cat = classifyError(raw, t.type);
      const norm = raw
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
        .replace(/\b\d{6,}\b/g, '<num>')
        .replace(/\d+ms/g, '<ms>')
        .replace(/@\w+/g, '<user>')
        .slice(0, 60);
      if (`${cat.category}::${norm}` === body.bucketId) matched.push(t.id);
    }
    if (!matched.length) return { dismissed: 0 };
    // PAUSED 是最接近"忽略"的现有状态：不再被 scheduler 拉起，也不在 failed 列表里
    await this.taskRepo.update(
      { id: In(matched) },
      { status: TaskStatus.PAUSED, errorMsg: () => `'(已忽略) ' || COALESCE("errorMsg", '')` },
    );
    return { dismissed: matched.length };
  }

  /**
   * M6: 账号自检 — 派发 SELF_TEST 任务到指定账号。
   * Agent 会跑 6 个轻量 RPC 探针，结果以 JSON 写入 task.errorMsg。
   * 前端 polling 此 task 直到 status != running，然后解析 errorMsg JSON 展示。
   */
  @Post('self-test/:accountId')
  @HttpCode(HttpStatus.OK)
  async dispatchSelfTest(
    @CurrentUser() user: AuthUser,
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ) {
    const tid = this.callerTenantId(user);
    // 先校验账号存在 + 属于当前租户
    const account = await this.accountRepo.findOneBy({ id: accountId });
    if (!account) return { error: 'account not found' };
    if (tid && account.tenantId !== tid) return { error: 'account not in your tenant' };

    const task = await this.tasks.create(
      {
        name: `🩺 自检 ${account.phoneNumber ?? account.id.slice(0, 8)}`,
        type: TaskType.SELF_TEST,
        accountId,
        payload: {},
        scheduledAt: new Date().toISOString(),
      },
      account.tenantId ?? undefined,
    );
    this.logger.log(`self-test dispatched: account=${accountId.slice(0, 8)} task=${task.id.slice(0, 8)}`);
    return { taskId: task.id };
  }
}

// ─── 错误分类规则 ──────────────────────────────────────────────────────

type ErrorCategory =
  | 'network_timeout'
  | 'flood_wait'
  | 'entity_not_found'
  | 'agent_offline'
  | 'auth_session'
  | 'permission_denied'
  | 'business_zero'
  | 'config'
  | 'unknown';

interface ClassifyResult {
  category: ErrorCategory;
  label: string;          // 中文展示
  hint: string;           // 修复建议
  retryable: boolean;     // 重试是否大概率能恢复
}

function classifyError(errorMsg: string, taskType: string): ClassifyResult {
  const msg = errorMsg.toLowerCase();

  // agent 离线 / watchdog 超时
  if (msg.includes('agent 可能已断线') || msg.includes('未完成') && msg.includes('15 分钟')) {
    return {
      category: 'agent_offline',
      label: 'Agent 离线 / 卡死',
      hint: '检查 telehubx-agent 进程：pm2 status；如已 stopped 重启 pm2 restart telehubx-agent',
      retryable: true,
    };
  }

  // RPC / 网络超时
  if (msg.includes('timeout') || msg.includes('超时') || msg.includes('rpc timeout')) {
    return {
      category: 'network_timeout',
      label: '网络/RPC 超时',
      hint: '一般是代理或 TG 端临时抖动，重试通常可恢复；持续出现则去「代理健康」看代理状态',
      retryable: true,
    };
  }

  // FloodWait / 频率限制
  if (msg.includes('flood') || msg.includes('floodwait') || msg.includes('rate limit') || msg.includes('频率')) {
    return {
      category: 'flood_wait',
      label: 'TG 限流 (FloodWait)',
      hint: '账号触发了 TG 频率限制，强制重试会加重风控。等账号 quarantine 解除后再试，或降低发送频率',
      retryable: false,
    };
  }

  // 实体不存在
  if (
    msg.includes('could not find') ||
    msg.includes('input entity') ||
    msg.includes('username_invalid') ||
    msg.includes('peer_id_invalid') ||
    msg.includes('解析目标') ||
    msg.includes('not found')
  ) {
    return {
      category: 'entity_not_found',
      label: '目标不存在 / 已删除',
      hint: '@username 已被删除、改名或群已解散。重试无效，需修改任务 payload 改成有效目标',
      retryable: false,
    };
  }

  // session / auth
  if (msg.includes('auth_key') || msg.includes('session') || msg.includes('unauthorized') || msg.includes('未登录')) {
    return {
      category: 'auth_session',
      label: 'Session 失效 / 未登录',
      hint: '账号 session 失效，需要重新绑定。账号页 → 该账号 → 重新登录',
      retryable: false,
    };
  }

  // 权限
  if (
    msg.includes('chat_admin_required') ||
    msg.includes('chat_write_forbidden') ||
    msg.includes('user_privacy_restricted') ||
    msg.includes('forbidden')
  ) {
    return {
      category: 'permission_denied',
      label: '权限不足 / 被拒',
      hint: '账号没权限发消息（被踢/被禁言/对方关闭私聊）。重试无效',
      retryable: false,
    };
  }

  // 业务零结果（不该 fail 的"成功但无数据"）
  if (
    msg.includes('0 候选人') ||
    msg.includes('no candidates') ||
    msg.includes('共匹') && msg.includes('0 候选') ||
    msg.includes('无目标')
  ) {
    return {
      category: 'business_zero',
      label: '零结果（非真错误）',
      hint: '任务执行了但没匹配到任何目标。这其实是业务"无结果"，不是技术故障。可调宽筛选条件或忽略',
      retryable: false,
    };
  }

  // 配置类
  if (
    msg.includes('payload') && (msg.includes('为空') || msg.includes('必填')) ||
    msg.includes('required') ||
    msg.includes('invalid') && msg.includes('config')
  ) {
    return {
      category: 'config',
      label: '配置缺失/错误',
      hint: '任务配置不完整。重试无效，需到任务详情页修改 payload',
      retryable: false,
    };
  }

  return {
    category: 'unknown',
    label: '未知错误',
    hint: '展开样本看完整错误信息，必要时联系平台',
    retryable: true,
  };
}
