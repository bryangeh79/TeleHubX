import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Faq, FaqSource } from './faq.entity';
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
}
