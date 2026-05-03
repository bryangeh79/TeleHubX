import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';
import { PlatformConfigService } from '../platform-config/platform-config.service';

interface GeneratedFaq {
  question: string;
  answer: string;
  tags: string[];
}

const SYSTEM_PROMPT = `你是 SaaS 产品的客服 FAQ 设计师。
任务：基于给定的产品资料文本，生成可直接用于客户自动回复的高质量 FAQ。

要求：
1. 问题用客户口吻提（"你们……" "这个怎么……"），不要用书面"如何"。
2. 答案直接、简洁、口语化，控制在 150 字内。如有电话/邮箱/网址等具体信息必须原样保留。
3. 覆盖：产品介绍 / 价格 / 联系方式 / 售前问答 / 常见疑问 / 售后流程。
4. 输出严格 JSON：{"faqs":[{"question":"...","answer":"...","tags":["..."]}]}。tags 用于分类（pricing/contact/intro/support 等）。
5. 没有写在资料里的信息，禁止臆造。`;

@Injectable()
export class AiFaqGeneratorService {
  private readonly logger = new Logger(AiFaqGeneratorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  /**
   * 解析平台 AI 配置：优先读 DB（管理面板配置），再 fallback 到 .env。
   * 与 AdTemplatesService.callPlatformAi 保持同一优先级逻辑。
   */
  private async resolveAiClient(): Promise<{ client: OpenAI; model: string }> {
    // 1. 尝试从 DB 读取（通过管理面板配置的 Platform AI Providers）
    const dbProvider = await this.platformConfig.getDefaultProvider().catch(() => null);
    if (dbProvider?.apiKey) {
      const providerId = isAiProviderId(dbProvider.provider) ? dbProvider.provider : 'openai';
      const providerDef = AI_PROVIDERS[providerId];
      const baseUrl = dbProvider.baseUrl || providerDef.baseUrl;
      const model = dbProvider.model || providerDef.defaultModel;
      this.logger.log(`[platform-ai] using DB provider=${providerId} model=${model}`);
      return { client: new OpenAI({ apiKey: dbProvider.apiKey, baseURL: baseUrl }), model };
    }

    // 2. Fallback: .env 环境变量（兼容旧配置）
    const platformOpenAi   = this.config.get<string>('PLATFORM_OPENAI_API_KEY');
    const platformDeepseek = this.config.get<string>('PLATFORM_DEEPSEEK_API_KEY');
    const platformGemini   = this.config.get<string>('PLATFORM_GEMINI_API_KEY');
    const legacyOpenAi     = this.config.get<string>('OPENAI_API_KEY');
    const legacyDeepseek   = this.config.get<string>('DEEPSEEK_API_KEY');
    const legacyGemini     = this.config.get<string>('GEMINI_API_KEY');

    const apiKey = platformOpenAi || platformDeepseek || platformGemini
      || legacyOpenAi || legacyDeepseek || legacyGemini;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        '平台 AI provider 未配置，无法生成 FAQ。请在「管理面板 → Prompt 配置」或 .env 中设置 AI Key。',
      );
    }
    const usingDeepseek = !!(platformDeepseek || (!platformOpenAi && !platformGemini && legacyDeepseek));
    const usingGemini   = !!(platformGemini || (!platformOpenAi && !platformDeepseek && !legacyOpenAi && !legacyDeepseek && legacyGemini));
    const baseURL = this.config.get<string>('PLATFORM_AI_BASE_URL')
      || this.config.get<string>('AI_BASE_URL')
      || (usingDeepseek ? 'https://api.deepseek.com'
        : usingGemini ? 'https://generativelanguage.googleapis.com/v1beta/openai'
        : 'https://api.openai.com/v1');
    const model = this.config.get<string>('PLATFORM_AI_MODEL')
      || this.config.get<string>('AI_MODEL')
      || (usingDeepseek ? 'deepseek-chat' : 'gpt-4o-mini');
    this.logger.log(`[platform-ai] using env fallback baseURL=${baseURL} model=${model}`);
    return { client: new OpenAI({ apiKey, baseURL }), model };
  }

  /**
   * 生成 FAQ：优先用管理面板配置的平台 AI Provider（DB），再 fallback 到 .env。
   */
  async generate(
    sourceText: string,
    options: { count?: number; goalPrompt?: string | null } = {},
  ): Promise<GeneratedFaq[]> {
    const { client, model } = await this.resolveAiClient();
    const count = Math.max(5, Math.min(50, options.count ?? 30));
    const truncated = sourceText.slice(0, 8000);

    const userPrompt = [
      options.goalPrompt ? `业务目标：${options.goalPrompt}` : '',
      `生成 ${count} 条 FAQ。`,
      `产品资料：\n${truncated}`,
    ].filter(Boolean).join('\n\n');

    let completion;
    try {
      completion = await client.chat.completions.create({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 4000,
      });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      this.logger.error(`AI generate failed status=${e.status} msg=${e.message}`);
      if (e.status === 401 || e.status === 403) {
        throw new ServiceUnavailableException('AI provider 鉴权失败，请检查 API key');
      }
      throw new BadGatewayException(`AI provider 错误: ${e.message ?? 'unknown'}`);
    }

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: { faqs?: GeneratedFaq[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error(`AI output not JSON: ${raw.slice(0, 200)}`);
      throw new BadGatewayException('AI 返回格式不是 JSON');
    }

    const faqs = Array.isArray(parsed.faqs) ? parsed.faqs : [];
    return faqs
      .filter((f) => f && typeof f.question === 'string' && typeof f.answer === 'string')
      .map((f) => ({
        question: f.question.trim(),
        answer: f.answer.trim(),
        tags: Array.isArray(f.tags) ? f.tags.filter((t) => typeof t === 'string') : [],
      }));
  }

  /**
   * Raw AI call — 返回模型的原始文本，由调用方自行解析。
   * 优先用 DB 配置的平台 AI Provider，再 fallback 到 .env。
   */
  async callRaw(systemPrompt: string, userPrompt: string, maxTokens = 6000): Promise<string> {
    const { client, model } = await this.resolveAiClient();
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    });
    return completion.choices[0]?.message?.content ?? '';
  }
}
