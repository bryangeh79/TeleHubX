import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { ChatScript, ChatScriptStatus, ChatScriptType, ScriptLine } from './chat-script.entity';
import { CreateChatScriptDto } from './dto/create-chat-script.dto';
import { UpdateChatScriptDto } from './dto/update-chat-script.dto';

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
export class ChatScriptsService {
  private readonly logger = new Logger(ChatScriptsService.name);
  private openai: OpenAI;
  private llmModel: string;

  constructor(
    @InjectRepository(ChatScript)
    private readonly repo: Repository<ChatScript>,
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
      this.logger.warn('No valid LLM API key found (tried OPENAI_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY). ChatScript seeding will return empty.');
      this.openai = new OpenAI({ apiKey: '' });
      this.llmModel = 'gpt-4o-mini';
    }
  }

  create(dto: CreateChatScriptDto): Promise<ChatScript> {
    const script = this.repo.create(dto as Partial<ChatScript>);
    return this.repo.save(script);
  }

  findAll(type?: ChatScriptType, status?: ChatScriptStatus): Promise<ChatScript[]> {
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
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
