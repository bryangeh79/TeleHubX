import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiFaqGeneratorService } from './ai-faq-generator.service';
import { EntityExtractorService } from './entity-extractor.service';
import { Faq, FaqSource } from './faq.entity';
import { FileParserService } from './file-parser.service';
import { KbProtected, ProtectedEntityType } from './kb-protected.entity';
import { KbSource, KbSourceKind, KbSourceStatus } from './kb-source.entity';
import { KbType, KnowledgeBase } from './kb.entity';
import { CreateKbDto, UpdateKbDto } from './dto/create-kb.dto';
import { CreateFaqDto, UpdateFaqDto } from './dto/create-faq.dto';

export interface FaqMatch {
  faq: Faq;
  score: number;
}

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeBase) private readonly kbs: Repository<KnowledgeBase>,
    @InjectRepository(Faq) private readonly faqs: Repository<Faq>,
    @InjectRepository(KbSource) private readonly sources: Repository<KbSource>,
    @InjectRepository(KbProtected) private readonly protectedEntities: Repository<KbProtected>,
    private readonly fileParser: FileParserService,
    private readonly entityExtractor: EntityExtractorService,
    private readonly aiFaqGen: AiFaqGeneratorService,
  ) {}

  // === KB CRUD ===
  createKb(dto: CreateKbDto): Promise<KnowledgeBase> {
    const kb = this.kbs.create(dto);
    return this.kbs.save(kb);
  }

  listKbs(filters: { type?: KbType; enabled?: boolean; tenantId?: string | null } = {}): Promise<KnowledgeBase[]> {
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    return this.kbs.find({ where, order: { createdAt: 'DESC' } });
  }

  async getKb(id: string): Promise<KnowledgeBase> {
    const kb = await this.kbs.findOneBy({ id });
    if (!kb) throw new NotFoundException(`KB ${id} not found`);
    return kb;
  }

  async updateKb(id: string, dto: UpdateKbDto): Promise<KnowledgeBase> {
    const kb = await this.getKb(id);
    Object.assign(kb, dto);
    await this.kbs.save(kb);
    return this.getKb(id);
  }

  async removeKb(id: string): Promise<void> {
    const kb = await this.getKb(id);
    await this.kbs.remove(kb);
  }

  // === FAQ CRUD ===
  async createFaq(dto: CreateFaqDto): Promise<Faq> {
    await this.getKb(dto.kbId); // 404 if KB missing
    const faq = this.faqs.create({ ...dto, source: dto.source ?? FaqSource.MANUAL });
    return this.faqs.save(faq);
  }

  listFaqs(filters: { kbId?: string; enabled?: boolean } = {}): Promise<Faq[]> {
    const where: Partial<Pick<Faq, 'kbId' | 'enabled'>> = {};
    if (filters.kbId) where.kbId = filters.kbId;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
    return this.faqs.find({ where, order: { hitCount: 'DESC', createdAt: 'DESC' } });
  }

  async getFaq(id: string): Promise<Faq> {
    const f = await this.faqs.findOneBy({ id });
    if (!f) throw new NotFoundException(`FAQ ${id} not found`);
    return f;
  }

  async updateFaq(id: string, dto: UpdateFaqDto): Promise<Faq> {
    const faq = await this.getFaq(id);
    Object.assign(faq, dto);
    await this.faqs.save(faq);
    return this.getFaq(id);
  }

  async removeFaq(id: string): Promise<void> {
    const faq = await this.getFaq(id);
    await this.faqs.remove(faq);
  }

  /**
   * Bulk import FAQs into a KB. Each item must have question + answer.
   * Returns count + ids of created.
   */
  async bulkImportFaqs(
    kbId: string,
    items: Array<{ question: string; answer: string; tags?: string[] }>,
  ): Promise<{ imported: number; ids: string[] }> {
    await this.getKb(kbId);
    const created: Faq[] = [];
    for (const it of items) {
      if (!it.question?.trim() || !it.answer?.trim()) continue;
      const faq = this.faqs.create({
        kbId,
        question: it.question.trim(),
        answer: it.answer.trim(),
        tags: it.tags,
        source: FaqSource.IMPORTED,
      });
      created.push(await this.faqs.save(faq));
    }
    return { imported: created.length, ids: created.map((c) => c.id) };
  }

  /**
   * Naive keyword retrieval — case-insensitive token overlap between query
   * and (question + tags). Returns top-N matches with score (0..1).
   * No vector DB / embeddings yet; this is the MVP that lets the auto-reply
   * decider have something useful to call.
   */
  async search(query: string, kbId?: string, topN = 5): Promise<FaqMatch[]> {
    const qTokens = this.tokenize(query);
    if (!qTokens.size) return [];

    const where: Partial<Pick<Faq, 'kbId' | 'enabled'>> = { enabled: true };
    if (kbId) where.kbId = kbId;
    const candidates = await this.faqs.find({ where });

    const scored = candidates.map<FaqMatch>((faq) => {
      const { score } = this.faqMatchScore(qTokens, faq);
      return { faq, score };
    });

    return scored
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  /** Increment hit counter when a FAQ is actually used to answer. */
  async recordHit(id: string): Promise<void> {
    await this.faqs.increment({ id }, 'hitCount', 1);
  }

  // === Sources (uploaded documents) ===

  async uploadSource(
    kbId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<KbSource> {
    await this.getKb(kbId);
    const kind = this.fileParser.detectKind(file.originalname, file.mimetype);
    let rawText = '';
    let status: KbSourceStatus = KbSourceStatus.PROCESSED;
    let errorMsg: string | null = null;
    try {
      rawText = await this.fileParser.parse(file.buffer, kind);
    } catch (err) {
      status = KbSourceStatus.FAILED;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    const src = this.sources.create({
      kbId,
      fileName: file.originalname,
      kind,
      mime: file.mimetype,
      byteSize: file.size,
      rawText,
      status,
      errorMsg,
      processedAt: status === KbSourceStatus.PROCESSED ? new Date() : null,
    });
    const saved = await this.sources.save(src);

    // Auto-extract protected entities (best-effort, non-fatal)
    if (status === KbSourceStatus.PROCESSED && rawText) {
      const extracted = this.entityExtractor.extract(rawText);
      for (const e of extracted) {
        try {
          await this.protectedEntities.save(
            this.protectedEntities.create({ kbId, ...e, sourceId: saved.id }),
          );
        } catch {
          // Unique constraint violation = already exists, skip silently
        }
      }
    }
    return saved;
  }

  async listSources(kbId: string): Promise<KbSource[]> {
    return this.sources.find({ where: { kbId }, order: { createdAt: 'DESC' } });
  }

  async getSource(id: string): Promise<KbSource> {
    const s = await this.sources.findOneBy({ id });
    if (!s) throw new NotFoundException(`Source ${id} not found`);
    return s;
  }

  async removeSource(id: string): Promise<void> {
    const s = await this.getSource(id);
    await this.sources.remove(s);
  }

  // === Protected entities ===

  listProtected(kbId: string): Promise<KbProtected[]> {
    return this.protectedEntities.find({ where: { kbId }, order: { createdAt: 'DESC' } });
  }

  async addProtected(kbId: string, entityType: ProtectedEntityType, value: string): Promise<KbProtected> {
    await this.getKb(kbId);
    const trimmed = value.trim();
    const existing = await this.protectedEntities.findOneBy({ kbId, entityType, value: trimmed });
    if (existing) return existing;
    const p = this.protectedEntities.create({ kbId, entityType, value: trimmed });
    return this.protectedEntities.save(p);
  }

  async removeProtected(id: string): Promise<void> {
    const p = await this.protectedEntities.findOneBy({ id });
    if (!p) throw new NotFoundException(`Protected entity ${id} not found`);
    await this.protectedEntities.remove(p);
  }

  // === AI FAQ generation ===

  async generateFaqsFromSources(
    kbId: string,
    options: { count?: number; sourceIds?: string[] } = {},
  ): Promise<{ generated: number; ids: string[] }> {
    const kb = await this.getKb(kbId);
    const where: { kbId: string; status: KbSourceStatus } = { kbId, status: KbSourceStatus.PROCESSED };
    let srcs = await this.sources.find({ where });
    if (options.sourceIds?.length) {
      const wanted = new Set(options.sourceIds);
      srcs = srcs.filter((s) => wanted.has(s.id));
    }
    const corpus = srcs.map((s) => s.rawText ?? '').filter(Boolean).join('\n\n---\n\n');
    if (!corpus.trim()) {
      throw new NotFoundException('No processed source text available for this KB. Upload a document first.');
    }

    const generated = await this.aiFaqGen.generate(corpus, {
      count: options.count,
      goalPrompt: kb.goalPrompt,
    });

    const created: Faq[] = [];
    for (const g of generated) {
      const faq = this.faqs.create({
        kbId,
        question: g.question,
        answer: g.answer,
        tags: g.tags,
        source: FaqSource.AI_GENERATED,
        enabled: true,
      });
      created.push(await this.faqs.save(faq));
    }
    return { generated: created.length, ids: created.map((f) => f.id) };
  }

  /**
   * AI 一键生成产品完整档案：简介 + 卖点 + FAQ + 建议目标。
   * FAQ 数量根据文本长度动态决定（30-50条），调用平台 AI key。
   */
  async generateProductProfile(dto: {
    productName: string;
    price?: string;
    rawText: string;
  }): Promise<{
    overview: string;
    features: string[];
    faq: Array<{ question: string; answer: string; tags: string[] }>;
    suggestedGoal: string;
  }> {
    // FAQ 数量根据资讯丰富程度动态调整
    const textLen = dto.rawText.trim().length;
    const faqCount = textLen < 500 ? 30 : textLen < 2000 ? 40 : 50;

    const systemPrompt = `你是一位专业的产品 FAQ 策划师兼销售顾问。
基于给定的产品资料，生成完整的产品知识档案，供智能客服 Bot 使用。
输出必须是严格的 JSON 格式，不要有任何多余文字。`;

    const userPrompt = `产品名称：${dto.productName}
价格：${dto.price ?? '联系询价'}
产品资料：
${dto.rawText.slice(0, 10000)}

请生成以下 JSON 格式（全部使用中文，除非资料是其他语言）：
{
  "overview": "产品简短介绍（2-3句，客服场景用）",
  "features": ["卖点1", "卖点2", "...（5-8条）"],
  "faq": [
    {"question": "客户口吻的问题", "answer": "简洁直接的回答（150字内）", "tags": ["分类标签"], "variants": ["同义问法1", "同义问法2", "同义问法3"]},
    ... 共 ${faqCount} 条
  ],
  "suggestedGoal": "预约 Demo（30 分钟线上演示）"
}

suggestedGoal 必须从以下选项之一选择：
- 预约 Demo（30 分钟线上演示）
- 收集线索（姓名/联系方式/需求）
- 了解更多（引导加 WhatsApp/Telegram）
- 联系销售员
- 申请免费试用

FAQ 要求：
- 问题用客户口吻（"你们...""这个怎么..."）
- 答案口语化、简洁
- 覆盖：产品功能/价格/使用场景/开始使用/支持/常见疑问
- **每条必须 3-5 个 variants（同义问法）**：客户用任一变体提问都能命中。变体要覆盖不同句式、口语/书面、长短句、常见错别字。例如「多少钱」的变体：「价格是多少」「贵不贵」「咋收费」
- 没有写在资料里的信息禁止编造`;

    // 复用 AiFaqGeneratorService 的 AI 调用基础设施（API key 选取逻辑）
    const raw = await this.aiFaqGen.callRaw(systemPrompt, userPrompt, 8000);

    let parsed: any;
    try {
      // 提取 JSON（有时 AI 会附加一些前后文字）
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error('AI 返回格式异常，请重试');
    }

    return {
      overview: String(parsed.overview ?? '').trim(),
      features: Array.isArray(parsed.features) ? parsed.features.map(String) : [],
      faq: Array.isArray(parsed.faq) ? parsed.faq.filter(
        (f: any) => f?.question && f?.answer
      ).map((f: any) => {
        const baseTags: string[] = Array.isArray(f.tags) ? f.tags.map(String) : [];
        const variants: string[] = Array.isArray(f.variants)
          ? f.variants.map(String).map((v: string) => v.trim()).filter((v: string) => v && v.length <= 100)
          : [];
        const tags = [...baseTags];
        for (const v of variants) tags.push(`var:${v}`);
        return {
          question: String(f.question).trim(),
          answer: String(f.answer).trim(),
          tags: tags.slice(0, 30),
        };
      }) : [],
      suggestedGoal: String(parsed.suggestedGoal ?? '预约 Demo（30 分钟线上演示）').trim(),
    };
  }

  /** Get all KB IDs for a tenant (used by smart reply to scope search) */
  async getKbIdsByTenant(tenantId: string): Promise<string[]> {
    const kbs = await this.kbs.find({ where: { tenantId, enabled: true } });
    return kbs.map(k => k.id);
  }

  /**
   * 繁简归一映射表 — 覆盖客服场景最常见的 70+ 繁体字。
   * 不追求完整 OpenCC 那种 8000+ 映射，只解决「同字 Jaccard 算不到」的痛点。
   */
  private static readonly TRAD_TO_SIMP: Record<string, string> = {
    妳: '你', 您: '你', 們: '们', 嗎: '吗', 個: '个', 麼: '么', 後: '后',
    為: '为', 與: '与', 來: '来', 對: '对', 會: '会', 開: '开', 關: '关',
    點: '点', 號: '号', 體: '体', 動: '动', 業: '业', 樣: '样', 給: '给',
    說: '说', 過: '过', 還: '还', 機: '机', 從: '从', 並: '并', 種: '种',
    處: '处', 將: '将', 經: '经', 該: '该', 訊: '讯', 計: '计', 認: '认',
    識: '识', 護: '护', 雙: '双', 幾: '几', 長: '长', 問: '问', 題: '题',
    課: '课', 學: '学', 寫: '写', 萬: '万', 億: '亿', 變: '变', 樂: '乐',
    達: '达', 線: '线', 連: '连', 應: '应', 類: '类', 訓: '训',
    紹: '绍', 紙: '纸', 細: '细', 終: '终', 結: '结', 績: '绩', 統: '统',
    網: '网', 資: '资', 費: '费', 質: '质', 買: '买', 賣: '卖', 賺: '赚',
    錢: '钱', 鐘: '钟', 國: '国', 圖: '图', 報: '报', 務: '务',
    場: '场', 員: '员', 簡: '简', 級: '级', 紅: '红', 綠: '绿', 藍: '蓝',
    龍: '龙', 馬: '马', 鳥: '鸟', 魚: '鱼', 時: '时', 間: '间', 條: '条',
    範: '范', 圍: '围', 戶: '户', 帳: '账', 數: '数',
    歲: '岁', 兒: '儿', 養: '养',
  };

  private normalizeTraditional(text: string): string {
    let out = '';
    for (const ch of text) {
      out += KnowledgeService.TRAD_TO_SIMP[ch] ?? ch;
    }
    return out;
  }

  /**
   * Tokenize a query/text for Jaccard similarity scoring.
   * - 中文按字符（含基本 + 扩展 + 平假名 + 韩文）
   * - 拉丁/数字按 ≥2 字符的 word
   * - 大小写归一化 + 繁简体 70+ 常用字映射
   */
  private tokenize(text: string): Set<string> {
    const out = new Set<string>();
    const lowered = text.toLowerCase().trim();
    if (!lowered) return out;
    const normalized = this.normalizeTraditional(lowered);
    const cjkRe = /[一-鿿぀-ヿ가-힯]/;
    for (const ch of Array.from(normalized)) {
      if (cjkRe.test(ch)) out.add(ch);
    }
    const latinWords = normalized.match(/[a-z0-9]{2,}/g);
    if (latinWords) for (const w of latinWords) out.add(w);
    return out;
  }

  /** Jaccard 相似度：|A ∩ B| / |A ∪ B|。返回 0..1。 */
  private jaccard(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
  }

  /** 从 FAQ tags 提取 `var:xxx` 形式的问题变体。 */
  private extractVariants(tags: string[] | null | undefined): string[] {
    if (!Array.isArray(tags)) return [];
    const out: string[] = [];
    for (const t of tags) {
      if (typeof t === 'string' && t.startsWith('var:')) {
        const v = t.slice(4).trim();
        if (v) out.push(v);
      }
    }
    return out;
  }

  /**
   * 计算 query 与一条 FAQ 的最佳匹配分（Jaccard），
   * 候选项 = FAQ 题目 + 所有 var:xxx 变体。
   */
  private faqMatchScore(queryTokens: Set<string>, faq: Faq): { score: number; matchedVariant?: string } {
    const candidates: Array<{ text: string; isVariant: boolean }> = [
      { text: faq.question, isVariant: false },
    ];
    for (const v of this.extractVariants(faq.tags)) {
      candidates.push({ text: v, isVariant: true });
    }
    let best = 0;
    let bestVariant: string | undefined;
    for (const c of candidates) {
      const s = this.jaccard(queryTokens, this.tokenize(c.text));
      if (s > best) {
        best = s;
        bestVariant = c.isVariant ? c.text : undefined;
      }
    }
    return { score: best, matchedVariant: bestVariant };
  }

  /**
   * Search across all KBs for a tenant and return formatted context string.
   * Used by BotGateway to inject relevant knowledge into AI system prompt.
   * Returns top-N matches formatted as Q&A pairs PLUS metadata about which
   * KBs were hit so callers can read description.customerType / useCompanyFallback.
   */
  async searchForContext(
    query: string,
    tenantId: string,
    topN = 5,
  ): Promise<{
    contextText: string;
    hasResults: boolean;
    matchedKbs: KnowledgeBase[];
    productHitCount: number;
  }> {
    const kbs = await this.kbs.find({ where: { tenantId, enabled: true } });
    if (!kbs.length) return { contextText: '', hasResults: false, matchedKbs: [], productHitCount: 0 };
    const kbById = new Map<string, KnowledgeBase>(kbs.map(k => [k.id, k]));
    const kbIds = kbs.map(k => k.id);

    const qTokens = this.tokenize(query);
    if (!qTokens.size) return { contextText: '', hasResults: false, matchedKbs: [], productHitCount: 0 };

    const candidates = await this.faqs.find({ where: { enabled: true } });
    const tenantFaqs = candidates.filter(f => kbIds.includes(f.kbId));

    const scored = tenantFaqs.map(faq => {
      const { score } = this.faqMatchScore(qTokens, faq);
      return { faq, score };
    });

    // 上下文注入用更宽松的阈值（0.25），让低分相关 FAQ 也能进 prompt 给 AI 参考
    const top = scored
      .filter(m => m.score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    if (!top.length) return { contextText: '', hasResults: false, matchedKbs: [], productHitCount: 0 };

    const matchedKbIds = new Set(top.map(m => m.faq.kbId));
    const matchedKbs = Array.from(matchedKbIds).map(id => kbById.get(id)).filter((k): k is KnowledgeBase => !!k);
    const productHitCount = top.filter(m => kbById.get(m.faq.kbId)?.type === KbType.PRODUCT).length;

    const lines = top.map(m => `问：${m.faq.question}\n答：${m.faq.answer}`);
    const contextText = [
      '【产品知识库（相关内容）】',
      ...lines,
      '【以上是产品资料，请基于此回答客户问题，不要凭空捏造】',
    ].join('\n\n');

    return { contextText, hasResults: true, matchedKbs, productHitCount };
  }

  /**
   * Search ONLY company-type KBs as a fallback when product KB hits are weak.
   * Returns formatted context tagged as 公司通用资料 so AI can distinguish.
   */
  async searchCompanyContext(
    query: string,
    tenantId: string,
    topN = 5,
  ): Promise<{ contextText: string; hasResults: boolean }> {
    const companyKbs = await this.kbs.find({
      where: { tenantId, enabled: true, type: KbType.COMPANY },
    });
    if (!companyKbs.length) return { contextText: '', hasResults: false };
    const kbIdSet = new Set(companyKbs.map(k => k.id));

    const qTokens = this.tokenize(query);
    if (!qTokens.size) return { contextText: '', hasResults: false };

    const candidates = await this.faqs.find({ where: { enabled: true } });
    const companyFaqs = candidates.filter(f => kbIdSet.has(f.kbId));

    const scored = companyFaqs.map(faq => {
      const { score } = this.faqMatchScore(qTokens, faq);
      return { faq, score };
    });

    const top = scored
      .filter(m => m.score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    // Even if no FAQ hits, fall back to company KB description/goalPrompt
    if (!top.length) {
      const desc = companyKbs[0]?.description?.trim();
      const goal = companyKbs[0]?.goalPrompt?.trim();
      const blob = [desc, goal].filter(Boolean).join('\n');
      if (!blob) return { contextText: '', hasResults: false };
      return {
        contextText: `【公司通用资料】\n${blob}`,
        hasResults: true,
      };
    }

    const lines = top.map(m => `问：${m.faq.question}\n答：${m.faq.answer}`);
    return {
      contextText: ['【公司通用资料（兜底参考）】', ...lines].join('\n\n'),
      hasResults: true,
    };
  }

  /**
   * 列出本租户在售的所有产品（产品 KB 的名称 + 简介）。
   * 用于在 AI prompt 顶部注入产品菜单，让 AI 区分元问题（"你有什么产品"）
   * vs 细节问题（"M33 多少钱"）。
   */
  async getProductRoster(tenantId: string): Promise<Array<{
    id: string;
    name: string;
    overview: string;
    price: string;
    customerType?: 'b2b' | 'b2c' | 'mixed';
  }>> {
    const productKbs = await this.kbs.find({
      where: { tenantId, enabled: true, type: KbType.PRODUCT },
      order: { createdAt: 'ASC' },
    });
    return productKbs.map(kb => {
      let overview = '';
      let price = '';
      let productName = kb.name?.replace(/\s*-\s*产品资料$/, '').trim() ?? kb.name;
      let customerType: 'b2b' | 'b2c' | 'mixed' | undefined;
      if (kb.description) {
        try {
          const desc = JSON.parse(kb.description);
          overview = String(desc.overview ?? '').trim();
          price = String(desc.price ?? '').trim();
          if (desc.productName) productName = String(desc.productName).trim();
          if (desc.customerType === 'b2b' || desc.customerType === 'b2c' || desc.customerType === 'mixed') {
            customerType = desc.customerType;
          }
        } catch { /* description not JSON */ }
      }
      return { id: kb.id, name: productName, overview, price, customerType };
    });
  }

  /**
   * Find the company KB for a tenant (type='company'). Used by general-FAQ
   * convenience routes. Returns null if no company KB exists.
   */
  async getCompanyKb(tenantId: string): Promise<KnowledgeBase | null> {
    const list = await this.kbs.find({
      where: { tenantId, type: KbType.COMPANY },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
    return list[0] ?? null;
  }

  /**
   * Get-or-create the company KB for a tenant. Used when user opens general-FAQ
   * editor before they've completed CompanyInfoWizard — we still need a KB to
   * attach FAQs to.
   */
  async getOrCreateCompanyKb(tenantId: string): Promise<KnowledgeBase> {
    const existing = await this.getCompanyKb(tenantId);
    if (existing) return existing;
    const created = this.kbs.create({
      tenantId,
      name: '公司通用资料',
      type: KbType.COMPANY,
      isDefault: true,
      enabled: true,
    });
    return this.kbs.save(created);
  }

  /**
   * AI 一键生成通用闲聊 FAQ —— 客户和 Bot 闲聊场景的常见问答。
   * 与产品 FAQ 不同：不依赖产品资料，专注客户问"你是真人吗"这类身份/能力/工作时间问题。
   */
  async generateGeneralChatFaqs(tenantId: string, count = 12): Promise<{ generated: number; ids: string[] }> {
    const kb = await this.getOrCreateCompanyKb(tenantId);

    const systemPrompt = `你是一位资深 AI 客服设计师，专门设计「客户和 Bot 闲聊」场景的回应。
任务：生成客户与营销客服 Bot 闲聊场景的常见问答（非业务问题）。

要求：
1. 问题覆盖：身份疑问（你是真人吗）/ 能力试探（你能干嘛）/ 工作时间（你 24 小时在吗）/ 礼貌寒暄（早上好）/ 玩笑调侃 / 表达情绪 / 询问 Bot 自己 / 离开告别等。
2. 答案要：保持人设但不假装是真人；自然引导回业务主题；语气亲切；不超过 50 字。
3. 不要触及产品具体细节（那是产品 FAQ 的工作）。
4. **每条必须 4-6 个 variants（同义问法）**，覆盖客户可能用的各种说法：长短句 / 口语 / 错别字 / 地方说法。例如「你是真人吗」的变体：「你是机器人？」「真的人在打字？」「不是 AI 吧」「你 ai 哒？」
5. 输出严格 JSON：{"faqs":[{"question":"...","answer":"...","tags":["..."],"variants":["...","...","..."]}]}。tags 用 chitchat / identity / capability / hours / greeting 等。`;

    const userPrompt = `请为本租户的客服 Bot 生成 ${count} 条「客户闲聊」场景 FAQ。`;

    const raw = await this.aiFaqGen.callRaw(systemPrompt, userPrompt, 4000);
    let parsed: { faqs?: Array<{ question: string; answer: string; tags?: string[] }> };
    try {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error('AI 返回格式异常，请重试');
    }

    const items = Array.isArray(parsed.faqs) ? parsed.faqs : [];
    const created: Faq[] = [];
    for (const it of items as any[]) {
      if (!it?.question?.trim() || !it?.answer?.trim()) continue;
      const baseTags: string[] = Array.isArray(it.tags) ? it.tags.map(String) : ['chitchat'];
      const variants: string[] = Array.isArray(it.variants)
        ? it.variants.map(String).map((v: string) => v.trim()).filter((v: string) => v && v.length <= 100)
        : [];
      const tags = [...baseTags];
      for (const v of variants) tags.push(`var:${v}`);
      const faq = this.faqs.create({
        kbId: kb.id,
        question: it.question.trim(),
        answer: it.answer.trim(),
        tags: tags.slice(0, 30),
        source: FaqSource.AI_GENERATED,
        enabled: true,
      });
      created.push(await this.faqs.save(faq));
    }
    return { generated: created.length, ids: created.map(f => f.id) };
  }

  /**
   * 为已有 FAQ 反补 var:xxx 变体（用于升级老 FAQ 进入语义匹配体系）。
   * 调用 AI 一次性为指定 KB 的所有/部分 FAQ 生成 4 个 variants 并写入 tags。
   * 已有 var:xxx tag 的 FAQ 默认跳过（除非 force=true）。
   */
  async backfillVariantsForKb(kbId: string, options: { force?: boolean } = {}): Promise<{ updated: number; skipped: number }> {
    const kb = await this.getKb(kbId);
    const allFaqs = await this.faqs.find({ where: { kbId } });
    const targets = options.force
      ? allFaqs
      : allFaqs.filter(f => !this.extractVariants(f.tags).length);

    if (!targets.length) return { updated: 0, skipped: allFaqs.length };

    // 每批 20 条，控制单次 AI tokens
    const BATCH = 20;
    let updated = 0;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const list = batch.map((f, idx) => `${idx + 1}. Q: ${f.question}\n   A: ${f.answer.slice(0, 200)}`).join('\n\n');
      const systemPrompt = `你是 FAQ 语义扩展器。给定一组 FAQ（题目 + 答案），为每条 FAQ 生成 4 个客户可能的同义问法（variants）。
要求：
- 同一意图，不同句式（长/短/口语/书面/倒装/省略）
- 包含常见错别字、缩写、地方说法
- 每个 variant ≤ 30 字
- **顺序与编号必须与输入对齐**
输出严格 JSON：{"variants":[["v1","v2","v3","v4"], ["v1","v2","v3","v4"], ...]} —— 数组长度 = 输入 FAQ 数。`;
      const userPrompt = `KB 名称：${kb.name}\n\n${list}\n\n请为以上 ${batch.length} 条 FAQ 各生成 4 个 variants。`;

      const raw = await this.aiFaqGen.callRaw(systemPrompt, userPrompt, 4000);
      let parsed: { variants?: string[][] };
      try {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch {
        continue; // 这一批解析失败就跳过，不阻断后续
      }

      const variantsList = Array.isArray(parsed.variants) ? parsed.variants : [];
      for (let j = 0; j < batch.length; j++) {
        const faq = batch[j];
        const vs = Array.isArray(variantsList[j]) ? variantsList[j] : [];
        const cleaned = vs.map(String).map(s => s.trim()).filter(s => s && s.length <= 100);
        if (!cleaned.length) continue;
        // 移除旧 var: tag (如果 force) 后追加新 var:
        const existingNonVar = (faq.tags ?? []).filter(t => typeof t === 'string' && !t.startsWith('var:'));
        const newTags = [...existingNonVar, ...cleaned.map(v => `var:${v}`)].slice(0, 30);
        faq.tags = newTags;
        await this.faqs.save(faq);
        updated++;
      }
    }

    return { updated, skipped: allFaqs.length - updated };
  }
}
