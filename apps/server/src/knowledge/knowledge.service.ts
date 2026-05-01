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

  listKbs(filters: { type?: KbType; enabled?: boolean } = {}): Promise<KnowledgeBase[]> {
    const where: Partial<Pick<KnowledgeBase, 'type' | 'enabled'>> = {};
    if (filters.type) where.type = filters.type;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
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
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length === 0) return [];

    const where: Partial<Pick<Faq, 'kbId' | 'enabled'>> = { enabled: true };
    if (kbId) where.kbId = kbId;
    const candidates = await this.faqs.find({ where });

    const scored = candidates.map<FaqMatch>((faq) => {
      const haystack = (
        faq.question.toLowerCase() + ' ' + (faq.tags ?? []).join(' ').toLowerCase()
      );
      let hits = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) hits++;
      }
      return { faq, score: hits / tokens.length };
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

  /** Get all KB IDs for a tenant (used by smart reply to scope search) */
  async getKbIdsByTenant(tenantId: string): Promise<string[]> {
    const kbs = await this.kbs.find({ where: { tenantId, enabled: true } });
    return kbs.map(k => k.id);
  }

  /**
   * Search across all KBs for a tenant and return formatted context string.
   * Used by BotGateway to inject relevant knowledge into AI system prompt.
   * Returns top-N matches formatted as Q&A pairs.
   */
  async searchForContext(
    query: string,
    tenantId: string,
    topN = 5,
  ): Promise<{ contextText: string; hasResults: boolean }> {
    const kbIds = await this.getKbIdsByTenant(tenantId);
    if (!kbIds.length) return { contextText: '', hasResults: false };

    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(t => t.length >= 2);
    if (!tokens.length) return { contextText: '', hasResults: false };

    // Search across all tenant KBs
    const candidates = await this.faqs.find({
      where: { enabled: true },
      relations: [],
    });
    const tenantFaqs = candidates.filter(f => kbIds.includes(f.kbId));

    const scored = tenantFaqs.map(faq => {
      const haystack = faq.question.toLowerCase() + ' ' + (faq.tags ?? []).join(' ').toLowerCase();
      let hits = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) hits++;
      }
      // Also check answer for context relevance
      const answerHits = tokens.filter(t => faq.answer.toLowerCase().includes(t)).length;
      const score = (hits * 2 + answerHits * 0.5) / (tokens.length * 2);
      return { faq, score };
    });

    const top = scored
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    if (!top.length) return { contextText: '', hasResults: false };

    const lines = top.map(m =>
      `问：${m.faq.question}\n答：${m.faq.answer}`
    );

    const contextText = [
      '【产品知识库（相关内容）】',
      ...lines,
      '【以上是产品资料，请基于此回答客户问题，不要凭空捏造】',
    ].join('\n\n');

    return { contextText, hasResults: true };
  }
}
