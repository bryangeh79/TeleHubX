import { Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { ChatScript, ChatScriptStatus, ChatScriptType, ScriptLine } from './chat-script.entity';
import { CreateChatScriptDto } from './dto/create-chat-script.dto';
import { UpdateChatScriptDto } from './dto/update-chat-script.dto';
import { getDataPaths } from '../common/paths';

const AB_TOPICS = [
  '产品咨询', '使用体验', '行业讨论', '价格对比',
  '技术问题', '教程分享', '案例讨论', '功能推荐',
];

const ABCD_TOPICS = [
  '产品测评', '技术讨论', '行业新闻', '使用心得',
  '问题求助', '功能对比', '教程分享', '案例讨论',
];

const AB_PROMPT = `你是一个 Telegram 群聊剧本生成器。请生成一段 {minRound}-{maxRound} 轮的 A+B 双人对话（中文），
模拟两个真实用户在讨论某个话题。话题列表：["产品咨询","使用体验","行业讨论","价格对比","技术问题","教程分享","案例讨论","功能推荐"]。
要求：
1. 每行格式：\`A: 对话内容\` 或 \`B: 对话内容\`
2. 对话自然、口语化、带情感
3. 偶尔在句子中加入 emoji（约30%的句子）
4. 不要有开场白/结束语等元描述
5. 纯对话内容`;

const ABCD_PROMPT = `你是一个 Telegram 群聊剧本生成器。请生成一段 {minRound}-{maxRound} 轮的 A+B+C+D 四人对话（中文），
模拟四个用户在群组讨论的话题。话题列表：["产品测评","技术讨论","行业新闻","使用心得","问题求助","功能对比","教程分享","案例讨论"]。
要求：
1. 每行格式：\`A: 对话内容\` 或 \`B: 对话内容\` 或 \`C: 对话内容\` 或 \`D: 对话内容\`
2. 对话自然、有人物性格差异（A热情推荐、B理性分析、C好奇提问、D分享经验）
3. 约30%的句子带 emoji
4. 不要元描述，纯对话`;

@Injectable()
export class ChatScriptsService implements OnModuleInit {
  private readonly logger = new Logger(ChatScriptsService.name);
  private openai: OpenAI | null = null;
  private llmModel: string = 'gpt-4o-mini';

  constructor(
    @InjectRepository(ChatScript)
    private readonly repo: Repository<ChatScript>,
    private readonly config: ConfigService,
  ) {
    const openaiKey = process.env.OPENAI_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (openaiKey) {
      this.logger.log('Using OpenAI provider for ChatScript generation');
      this.openai = new OpenAI({ apiKey: openaiKey });
      this.llmModel = 'gpt-4o-mini';
    } else if (deepseekKey) {
      this.logger.log('Using DeepSeek provider for ChatScript generation');
      this.openai = new OpenAI({
        apiKey: deepseekKey,
        baseURL: 'https://api.deepseek.com/v1',
      });
      this.llmModel = 'deepseek-chat';
    } else if (geminiKey) {
      this.logger.log('Using Gemini provider for ChatScript generation');
      this.openai = new OpenAI({
        apiKey: geminiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1/openai',
      });
      this.llmModel = 'gemini-2.0-flash';
    } else {
      // Issue #14 vmfix4: no LLM key is fine. Server boots; LLM-backed
      // ChatScript seeding becomes a no-op. Tenant can configure an AI key
      // later via dashboard. Newer openai SDK throws on empty apiKey at
      // construction, so we keep this.openai = null instead of instantiating.
      this.logger.warn('No LLM API key found (OPENAI_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY). ChatScript LLM seeding disabled — configure an AI key in the dashboard to enable.');
    }
  }

  /**
   * vmfix20 (Issue #28): on boot, scan {dataDir}/script-packs/*.json and
   * import any pack JSON we haven't seen yet via importPackBlob (which is
   * already idempotent per packId+name). Skips the archived/ subdirectory.
   *
   * SeedPack drops curated packs (A+B 30 scripts, A+B+C+D 50 scripts) here.
   * Tenants can also drop their own .json packs into this directory.
   */
  async onModuleInit(): Promise<void> {
    try {
      const paths = getDataPaths(this.config);
      const packsDir = path.join(paths.root, 'script-packs');
      if (!fs.existsSync(packsDir)) {
        this.logger.log(`script-packs directory not present at ${packsDir} — skipping seed scan`);
        return;
      }
      const files = fs.readdirSync(packsDir, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
        .map(e => path.join(packsDir, e.name));
      if (!files.length) {
        this.logger.log('script-packs scan: 0 .json files found');
        return;
      }
      let totalInserted = 0;
      let totalSkipped = 0;
      for (const file of files) {
        try {
          const blob = JSON.parse(fs.readFileSync(file, 'utf8'));
          const r = await this.importPackBlob(blob);
          totalInserted += r.inserted;
          totalSkipped += r.skipped;
          this.logger.log(`script-packs: imported ${path.basename(file)} (pack=${r.packId}, +${r.inserted} new, ${r.skipped} skipped)`);
        } catch (err: any) {
          this.logger.warn(`script-packs: skipping ${path.basename(file)} — ${err?.message ?? err}`);
        }
      }
      this.logger.log(`script-packs scan: ${totalInserted} new scripts inserted, ${totalSkipped} skipped, ${files.length} files processed`);
    } catch (err: any) {
      this.logger.error(`script-packs scan failed: ${err?.message ?? err}`);
    }
  }

  create(dto: CreateChatScriptDto): Promise<ChatScript> {
    // vmfix30 A2: 防御性兜底 — 即使 entity default 被未来改回 DRAFT，
    // 这里也保证 dashboard 新建的剧本默认 ACTIVE，立刻可在「指定剧本」下拉看到。
    // dto 显式传 status 时尊重 dto。
    const script = this.repo.create({
      status: ChatScriptStatus.ACTIVE,
      ...(dto as Partial<ChatScript>),
    });
    return this.repo.save(script);
  }

  findAll(type?: ChatScriptType, status?: ChatScriptStatus, tenantId?: string | null): Promise<ChatScript[]> {
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (tenantId) where.tenantId = tenantId;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  /**
   * Agent 端 chat_script_* executor 调用：随机抽 1 个剧本（含 rawScript 完整结构）。
   * 默认只抽 ACTIVE 状态。可选过滤：packId, category, type。
   */
  async pickRandom(opts: {
    packId?: string;
    category?: string;
    type?: ChatScriptType;
    tenantId?: string;     // Codex #11: 强制按 tenant 过滤
  } = {}): Promise<ChatScript | null> {
    // 用 query builder 支持 OR (tenantId IS NULL = 平台内置可共享) 的语义
    const qb = this.repo.createQueryBuilder('s')
      .where('s.status = :st', { st: ChatScriptStatus.ACTIVE });
    if (opts.packId) qb.andWhere('s.packId = :pid', { pid: opts.packId });
    if (opts.category) qb.andWhere('s.category = :c', { c: opts.category });
    if (opts.type) qb.andWhere('s.type = :t', { t: opts.type });
    if (opts.tenantId) {
      // 自有 + 平台共享 (tenantId IS NULL) 都可见
      qb.andWhere('(s.tenantId = :tid OR s.tenantId IS NULL)', { tid: opts.tenantId });
    }
    const list = await qb.getMany();
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  /**
   * 列出所有剧本包（按 packId group），带计数 + 类型 + 语种。
   *
   * vmfix30 A3: 加 tenantId 过滤。租户只看到「自有 + 平台共享 (tenantId IS NULL)」。
   * 避免跨租户 leak pack 名 + count。SUPER_ADMIN 传 null 时看全部。
   */
  async listPacks(tenantId?: string | null): Promise<Array<{ packId: string; count: number; types: string[]; categories: string[] }>> {
    const qb = this.repo.createQueryBuilder('s');
    if (tenantId) {
      // 自有 + 平台共享（tenantId IS NULL）都可见
      qb.where('(s.tenantId = :tid OR s.tenantId IS NULL)', { tid: tenantId });
    }
    const all = await qb.getMany();
    const map = new Map<string, { count: number; types: Set<string>; categories: Set<string> }>();
    for (const s of all) {
      const key = s.packId ?? '(自建)';
      if (!map.has(key)) map.set(key, { count: 0, types: new Set(), categories: new Set() });
      const e = map.get(key)!;
      e.count++;
      e.types.add(s.type);
      if (s.category) e.categories.add(s.category);
    }
    return Array.from(map.entries())
      .map(([packId, v]) => ({
        packId,
        count: v.count,
        types: Array.from(v.types),
        categories: Array.from(v.categories),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** 删除整个 pack 的所有剧本。 */
  async deletePack(packId: string): Promise<{ deleted: number }> {
    const res = await this.repo.delete({ packId });
    return { deleted: res.affected ?? 0 };
  }

  /**
   * 上传单个 pack JSON 文件并导入。幂等：同 packId+name 跳过。
   * 复用 scripts/import-script-packs.js 的解析逻辑（这里是 inline 简版）。
   */
  async importPackBlob(blob: any): Promise<{ packId: string; inserted: number; skipped: number }> {
    if (!blob?.scripts || !Array.isArray(blob.scripts)) {
      throw new Error('JSON 缺少 scripts[] 字段');
    }
    const packId = blob.pack_id || blob.pack_ref;
    if (!packId) throw new Error('JSON 必须含 pack_id 或 pack_ref');

    const flatten = (sessions: any[]): ScriptLine[] => {
      const lines: ScriptLine[] = [];
      for (const sess of sessions) {
        for (const t of sess.turns ?? []) {
          let text = '';
          if (t.content_pool?.length) text = t.content_pool[0];
          else if (t.caption_pool?.length) text = t.caption_pool[0];
          else if (t.caption_fallback) text = t.caption_fallback;
          else if (t.asset_pool) text = `[${t.type}: ${t.asset_pool}]`;
          else text = '...';
          const sd = t.send_delay_sec ?? [30, 90];
          lines.push({
            roleLabel: t.role,
            text,
            allowEmoji: true,
            delayAfterMs: Math.round(((sd[0] + sd[1]) / 2) * 1000),
            delayStdDevMs: Math.round(((sd[1] - sd[0]) / 4) * 1000),
          });
        }
      }
      return lines;
    };

    // vmfix26 #15: detect ABCDEF (6 人) properly — old logic capped at ABCD.
    // 6-role packs were silently downgraded to ABCD type → chat_script_6p
    // tasks could never pickRandom them. Boundaries:
    //   2 distinct roles  → AB
    //   3-4 distinct roles → ABCD
    //   ≥5 distinct roles → ABCDEF
    const detectType = (scripts: any[]): ChatScriptType => {
      const roles = new Set<string>();
      for (const s of scripts.slice(0, 1)) {
        for (const sess of s.sessions) for (const t of sess.turns) roles.add(t.role);
      }
      if (roles.size >= 5) return ChatScriptType.ABCDEF;
      if (roles.size >= 3) return ChatScriptType.ABCD;
      return ChatScriptType.AB;
    };

    const packType = detectType(blob.scripts);
    let inserted = 0, skipped = 0;
    for (const s of blob.scripts) {
      const existing = await this.repo.findOne({ where: { packId, name: s.name } });
      if (existing) { skipped++; continue; }
      const lines = flatten(s.sessions);
      const totalTurns = s.total_turns ?? lines.length;
      const rec = this.repo.create({
        tenantId: null as any,
        name: s.name,
        type: packType,
        minRound: Math.max(2, Math.floor(totalTurns * 0.7)),
        maxRound: totalTurns,
        groupIds: [],
        accountIds: [],
        lines,
        packId,
        category: s.category ?? null,
        rawScript: s,
        status: ChatScriptStatus.ACTIVE,
      });
      await this.repo.save(rec);
      inserted++;
    }
    return { packId, inserted, skipped };
  }

  async findOne(id: string): Promise<ChatScript> {
    const script = await this.repo.findOneBy({ id });
    if (!script) throw new NotFoundException(`ChatScript ${id} not found`);
    return script;
  }

  async update(id: string, dto: UpdateChatScriptDto): Promise<ChatScript> {
    const script = await this.findOne(id);
    Object.assign(script, dto);
    await this.repo.save(script);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const script = await this.findOne(id);
    await this.repo.remove(script);
  }

  /**
   * 标记执行为 placeholder
   * TODO: agent execution — 对接实际的 Telegram client 对话执行逻辑
   */
  async execute(id: string): Promise<{ executedCount: number; lastExecutedAt: Date }> {
    const script = await this.findOne(id);
    script.executedCount += 1;
    script.lastExecutedAt = new Date();
    await this.repo.save(script);
    return { executedCount: script.executedCount, lastExecutedAt: script.lastExecutedAt };
  }

  /**
   * 生成 100 份 A+B 双人剧本（16-20 轮）
   * 使用 OpenAI LLM 生成内容
   */
  async seedAb(): Promise<ChatScript[]> {
    const scripts: ChatScript[] = [];
    for (let i = 0; i < 100; i++) {
      const topic = AB_TOPICS[Math.floor(Math.random() * AB_TOPICS.length)];
      const minRound = 16;
      const maxRound = 20;
      const actualRounds = this.randomInt(minRound, maxRound);
      const prompt = AB_PROMPT.replace('{minRound}', String(actualRounds)).replace('{maxRound}', String(actualRounds));
      const lines = await this.callLlm(prompt, actualRounds, 'A+B');
      if (!lines) continue;

      const script = this.repo.create({
        name: `A+B 对话剧本 #${i + 1} - ${topic}`,
        type: ChatScriptType.AB,
        minRound,
        maxRound,
        lines,
      });
      const saved = await this.repo.save(script);
      const fpath = this.saveToJsonFile(saved);
      this.logger.log(`A+B 剧本已保存: ${fpath}`);
      scripts.push(saved);
    }
    this.logger.log(`已生成 ${scripts.length} 份 A+B 剧本`);
    return scripts;
  }

  /**
   * 生成 50 份 A+B+C+D 四人剧本（50-70 轮）
   * 使用 OpenAI LLM 生成内容
   */
  async seedAbcd(): Promise<ChatScript[]> {
    const scripts: ChatScript[] = [];
    for (let i = 0; i < 50; i++) {
      const topic = ABCD_TOPICS[Math.floor(Math.random() * ABCD_TOPICS.length)];
      const minRound = 50;
      const maxRound = 70;
      const actualRounds = this.randomInt(minRound, maxRound);
      const prompt = ABCD_PROMPT.replace('{minRound}', String(actualRounds)).replace('{maxRound}', String(actualRounds));
      const lines = await this.callLlm(prompt, actualRounds, 'A+B+C+D');
      if (!lines) continue;

      const script = this.repo.create({
        name: `A+B+C+D 剧本 #${i + 1} - ${topic}`,
        type: ChatScriptType.ABCD,
        minRound,
        maxRound,
        lines,
      });
      const saved = await this.repo.save(script);
      const fpath = this.saveToJsonFile(saved);
      this.logger.log(`A+B+C+D 剧本已保存: ${fpath}`);
      scripts.push(saved);
    }
    this.logger.log(`已生成 ${scripts.length} 份 A+B+C+D 剧本`);
    return scripts;
  }

  private getScriptsDir(): string {
    // 优先用项目根 scripts/ 目录，fallback 到当前目录
    const candidates = [
      path.resolve(process.cwd(), '..', '..', 'scripts'),  // pm2 cwd=apps/server
      path.resolve(process.cwd(), 'scripts'),
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'scripts'),
    ];
    for (const dir of candidates) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      } catch { /* try next */ }
    }
    return path.resolve(process.cwd(), 'scripts');
  }

  private saveToJsonFile(script: ChatScript): string {
    const scriptsDir = this.getScriptsDir();
    const prefix = script.type === ChatScriptType.AB ? 'ab' : 'abcd';
    // Sanitize name for filename
    const safeName = script.name.replace(/[^\w\u4e00-\u9fff-]/g, '_').slice(0, 40);
    const filename = `${prefix}_${script.id.slice(0, 8)}_${safeName}.json`;
    const filepath = path.join(scriptsDir, filename);

    const payload = {
      id: script.id,
      name: script.name,
      type: script.type,
      createdAt: script.createdAt,
      totalLines: script.lines.length,
      lines: script.lines.map((l, i) => ({
        seq: i + 1,
        role: l.roleLabel,
        text: l.text,
        allowEmoji: l.allowEmoji,
        delayAfterMs: l.delayAfterMs,
        delayStdDevMs: l.delayStdDevMs,
      })),
    };

    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');
    return filepath;
  }

  private async callLlm(
    prompt: string,
    expectedRounds: number,
    allowedRoles: string,
  ): Promise<ScriptLine[] | null> {
    if (!this.openai) {
      this.logger.warn('callLlm skipped: no LLM provider configured');
      return null;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: this.llmModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          max_tokens: 4096,
        });

        const content = response.choices[0]?.message?.content?.trim() || '';
        const lines = this.parseLines(content, allowedRoles);
        if (lines.length >= Math.floor(expectedRounds * 0.5)) {
          return lines;
        }
        this.logger.warn(`解析结果行数不足（尝试 ${attempt + 1}）：${lines.length} < ${expectedRounds}`);
      } catch (err) {
        this.logger.error(`LLM 调用失败（尝试 ${attempt + 1}）：${(err as Error).message}`);
      }
    }
    return null;
  }

  private parseLines(content: string, allowedRoles: string): ScriptLine[] {
    const roles = allowedRoles.split('+');
    const rolePattern = roles.join('|');
    const regex = new RegExp(`^(${rolePattern}):\\s*(.+)`, 'm');
    const lines: ScriptLine[] = [];

    for (const line of content.split('\n')) {
      const match = line.trim().match(regex);
      if (match) {
        lines.push({
          roleLabel: match[1] as 'A' | 'B' | 'C' | 'D',
          text: match[2].trim(),
          allowEmoji: true,
          delayAfterMs: this.randomInt(3000, 8000),
          delayStdDevMs: 1000,
        });
      }
    }
    return lines;
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
