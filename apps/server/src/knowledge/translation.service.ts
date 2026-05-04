import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { AI_PROVIDERS, isAiProviderId } from '../ai-agent/ai-providers';
import { PlatformAiConfig } from '../platform-config/platform-ai-config.entity';
import { Faq, FaqSource } from './faq.entity';
import { KnowledgeBase } from './kb.entity';

/**
 * i18n V1 — 业务内容翻译草稿服务 (Issue #1 Task C).
 *
 * 职责: 把已发布的 FAQ / KB 翻译成目标语言, 落库为 draft.
 *   - AI 调用走平台兜底 key (cost 由平台承担, 可被 prompt control 控制 token)
 *   - 翻译结果不直接发布 — status='draft', translatedFromId 记录来源
 *   - 必须 tenant scoped: 源内容必须属于当前租户 (或平台 tenantId=null)
 *
 * 红线 (Issue 要求):
 *   - AI 翻译结果必须 draft, 租户审核后手动 publish
 *   - 不得自动发布
 *   - 翻译过程不能改业务数字 / 价格 / 联系方式 / URL / 产品名
 *   - 不破坏 round-10 已修好的 tenant isolation
 */

const TRANSLATION_PROMPT = `你是专业的 SaaS 客户服务内容翻译师。
任务: 把给定的中文/英文/马来文/越南文内容翻译成指定的目标语言, 用于客服 FAQ 或公司资讯.

铁律 (违反任何一条 = 翻译失败):
1. 必须保留: 产品名 / 品牌名 / 公司名 / 价格 / 数字 / 货币符号 / 电话 / 邮箱 / 网址 / 套餐名 (一字不改).
2. 不得自创: 不要发明任何政策 / 价格 / 优惠 / 联系方式. 原文没有就不要写.
3. 不要扩写: 信息不全时保留原意, 不补内容. 用户原意是什么就翻什么.
4. FAQ 结构: 输入 question + answer 时, 输出仍是 question + answer 同义结构.
5. 公司资讯: 保持事实准确, 不要营销夸大或加形容词.
6. 输出语言: 完全使用目标语言自然表达, 不要中外混用.
7. 输出格式: 严格 JSON, 见下方示例.

支持目标语言:
  zh = 中文
  en = English
  ms = Bahasa Melayu (马来文)
  vi = Tiếng Việt (越南文)

输出 JSON 格式:
  FAQ:  {"question": "...", "answer": "..."}
  KB:   {"name": "...", "description": "...", "goalPrompt": "..."}

下面是要翻译的内容:`;

const LANG_NAMES: Record<string, string> = {
  zh: '中文', en: 'English', ms: 'Bahasa Melayu', vi: 'Tiếng Việt',
};

export interface TranslateRequest {
  targetLanguage: 'zh' | 'en' | 'ms' | 'vi';
  sourceLanguage?: string; // 可选, 默认从源对象 .language 取
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Faq) private readonly faqs: Repository<Faq>,
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(PlatformAiConfig) private readonly platformAiRepo: Repository<PlatformAiConfig>,
  ) {}

  /**
   * 翻译 FAQ 为目标语言, 返回新建的 draft FAQ.
   * - tenantId 必须与源 KB 的 tenantId 匹配 (caller 端校验)
   * - 同 KB + 同目标语言已存在 draft / published → 返回已存在的 (避免重复 token 消耗)
   */
  async translateFaqToDraft(
    faqId: string,
    req: TranslateRequest,
    callerTenantId: string | null | undefined,
  ): Promise<Faq> {
    if (!['zh', 'en', 'ms', 'vi'].includes(req.targetLanguage)) {
      throw new BadRequestException(`不支持的目标语言: ${req.targetLanguage}`);
    }

    const src = await this.faqs.findOneBy({ id: faqId });
    if (!src) throw new NotFoundException(`FAQ ${faqId} 不存在`);

    // tenant scope: 通过 KB 校验
    const srcKb = await this.kbs.findOneBy({ id: src.kbId });
    if (!srcKb) throw new NotFoundException(`FAQ ${faqId} 关联 KB 不存在`);
    if (srcKb.tenantId && srcKb.tenantId !== callerTenantId) {
      throw new BadRequestException('FAQ 不属于当前租户, 无法翻译');
    }

    const sourceLang = req.sourceLanguage ?? src.language ?? 'zh';
    if (sourceLang === req.targetLanguage) {
      throw new BadRequestException(`源语言与目标语言相同 (${sourceLang})`);
    }

    // 已有 draft / published → 直接返回 (不重复消耗 token)
    const existing = await this.faqs.findOne({
      where: { kbId: src.kbId, language: req.targetLanguage, translatedFromId: src.id },
    });
    if (existing) return existing;

    // 调 AI
    const { client, model } = await this.resolveAiClient();
    const userPrompt = `源语言: ${sourceLang} (${LANG_NAMES[sourceLang] ?? sourceLang})\n` +
      `目标语言: ${req.targetLanguage} (${LANG_NAMES[req.targetLanguage]})\n\n` +
      `源 FAQ:\n` +
      `Q: ${src.question}\n` +
      `A: ${src.answer}\n\n` +
      `请输出 JSON: {"question": "...", "answer": "..."}`;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: TRANSLATION_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }).catch((err) => {
      this.logger.error(`[translation] AI 调用失败: ${err?.message ?? err}`);
      throw new ServiceUnavailableException(`AI 翻译失败: ${err?.message ?? err}`);
    });

    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    let parsed: { question?: string; answer?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException(`AI 返回非 JSON: ${raw.slice(0, 200)}`);
    }
    if (!parsed.question || !parsed.answer) {
      throw new ServiceUnavailableException(`AI 返回缺 question/answer: ${raw.slice(0, 200)}`);
    }

    // 落库为 draft
    const draft = this.faqs.create({
      kbId: src.kbId,
      question: parsed.question.trim(),
      answer: parsed.answer.trim(),
      source: FaqSource.AI_GENERATED,
      tags: src.tags,
      enabled: true,
      language: req.targetLanguage,
      status: 'draft',
      translatedFromId: src.id,
    });
    return this.faqs.save(draft);
  }

  /**
   * 翻译 KB metadata (name / description / goalPrompt) 为目标语言, 返回新建的 draft KB.
   * 注意: 不翻译 KB 内的 FAQ — 那些走 translateFaqToDraft 一条条翻 (token 控制).
   */
  async translateKbToDraft(
    kbId: string,
    req: TranslateRequest,
    callerTenantId: string | null | undefined,
  ): Promise<KnowledgeBase> {
    if (!['zh', 'en', 'ms', 'vi'].includes(req.targetLanguage)) {
      throw new BadRequestException(`不支持的目标语言: ${req.targetLanguage}`);
    }

    const src = await this.kbs.findOneBy({ id: kbId });
    if (!src) throw new NotFoundException(`KB ${kbId} 不存在`);
    if (src.tenantId && src.tenantId !== callerTenantId) {
      throw new BadRequestException('KB 不属于当前租户, 无法翻译');
    }

    const sourceLang = req.sourceLanguage ?? src.language ?? 'zh';
    if (sourceLang === req.targetLanguage) {
      throw new BadRequestException(`源语言与目标语言相同 (${sourceLang})`);
    }

    const existing = await this.kbs.findOne({
      where: {
        tenantId: src.tenantId ?? undefined,
        type: src.type,
        language: req.targetLanguage,
        translatedFromId: src.id,
      } as any,
    });
    if (existing) return existing;

    const { client, model } = await this.resolveAiClient();
    const userPrompt = `源语言: ${sourceLang} (${LANG_NAMES[sourceLang] ?? sourceLang})\n` +
      `目标语言: ${req.targetLanguage} (${LANG_NAMES[req.targetLanguage]})\n\n` +
      `源 KB:\n` +
      `name: ${src.name}\n` +
      `description: ${src.description ?? ''}\n` +
      `goalPrompt: ${src.goalPrompt ?? ''}\n\n` +
      `请输出 JSON: {"name": "...", "description": "...", "goalPrompt": "..."}`;

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: TRANSLATION_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }).catch((err) => {
      this.logger.error(`[translation] AI 调用失败: ${err?.message ?? err}`);
      throw new ServiceUnavailableException(`AI 翻译失败: ${err?.message ?? err}`);
    });

    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    let parsed: { name?: string; description?: string; goalPrompt?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException(`AI 返回非 JSON: ${raw.slice(0, 200)}`);
    }
    if (!parsed.name) {
      throw new ServiceUnavailableException(`AI 返回缺 name: ${raw.slice(0, 200)}`);
    }

    const draftPartial: Partial<KnowledgeBase> = {
      tenantId: src.tenantId,
      name: parsed.name.trim(),
      type: src.type,
      description: parsed.description?.trim() ?? '',
      goalPrompt: parsed.goalPrompt?.trim() ?? null,
      isDefault: false, // 翻译版本不接管 default
      enabled: true,
      language: req.targetLanguage,
      status: 'draft',
      translatedFromId: src.id,
    };
    const draft = this.kbs.create(draftPartial);
    return this.kbs.save(draft);
  }

  /**
   * 发布 FAQ 草稿 (draft → published).
   */
  async publishFaq(faqId: string, callerTenantId: string | null | undefined): Promise<Faq> {
    const faq = await this.faqs.findOneBy({ id: faqId });
    if (!faq) throw new NotFoundException(`FAQ ${faqId} 不存在`);
    const kb = await this.kbs.findOneBy({ id: faq.kbId });
    if (kb?.tenantId && kb.tenantId !== callerTenantId) {
      throw new BadRequestException('FAQ 不属于当前租户');
    }
    faq.status = 'published';
    return this.faqs.save(faq);
  }

  /**
   * 发布 KB 草稿 (draft → published).
   */
  async publishKb(kbId: string, callerTenantId: string | null | undefined): Promise<KnowledgeBase> {
    const kb = await this.kbs.findOneBy({ id: kbId });
    if (!kb) throw new NotFoundException(`KB ${kbId} 不存在`);
    if (kb.tenantId && kb.tenantId !== callerTenantId) {
      throw new BadRequestException('KB 不属于当前租户');
    }
    kb.status = 'published';
    return this.kbs.save(kb);
  }

  /** 复用 ai-faq-generator 的 AI client 解析逻辑 (DB → env fallback). */
  private async resolveAiClient(): Promise<{ client: OpenAI; model: string }> {
    const dbProvider = await this.platformAiRepo
      .createQueryBuilder('p')
      .addSelect('p.apiKey')
      .where('p.isDefault = true AND p.isActive = true')
      .getOne()
      .catch(() => null);
    if (dbProvider?.apiKey) {
      const providerId = isAiProviderId(dbProvider.provider) ? dbProvider.provider : 'openai';
      const providerDef = AI_PROVIDERS[providerId];
      const baseUrl = dbProvider.baseUrl || providerDef.baseUrl;
      const model = dbProvider.model || providerDef.defaultModel;
      return { client: new OpenAI({ apiKey: dbProvider.apiKey, baseURL: baseUrl }), model };
    }
    // env fallback
    const envKey = this.config.get<string>('PLATFORM_OPENAI_API_KEY')
      ?? this.config.get<string>('OPENAI_API_KEY')
      ?? '';
    if (!envKey) {
      throw new ServiceUnavailableException('平台 AI Key 未配置, 无法翻译. 请到 Admin → AI 设置.');
    }
    return { client: new OpenAI({ apiKey: envKey }), model: 'gpt-4o-mini' };
  }
}
