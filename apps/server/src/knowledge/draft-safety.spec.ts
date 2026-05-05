/**
 * Issue #2 Round 2: 草稿 / language 过滤 unit tests.
 *
 * 覆盖:
 *   - search() 接受 status='published' 过滤
 *   - search() 接受 language 过滤
 *   - search() 旧签名 (kbId/topN/tenantId) 仍然工作
 *
 * 不依赖真 DB — mock Repository 验证生成的 query 行为正确.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KnowledgeService } from './knowledge.service';
import { Faq } from './faq.entity';
import { KnowledgeBase } from './kb.entity';
import { KbSource } from './kb-source.entity';
import { KbProtected } from './kb-protected.entity';
import { FileParserService } from './file-parser.service';
import { EntityExtractorService } from './entity-extractor.service';
import { AiFaqGeneratorService } from './ai-faq-generator.service';

describe('KnowledgeService — Issue #2 draft/language safety', () => {
  let service: KnowledgeService;
  let capturedQb: any = null;
  const mockFaqRepo = {
    createQueryBuilder: jest.fn(() => {
      const qb: any = {
        _conditions: [] as Array<{ clause: string; params: any }>,
        where(clause: string, params: any) { this._conditions.push({ clause, params }); return this; },
        andWhere(clause: string, params: any) { this._conditions.push({ clause, params }); return this; },
        getMany: jest.fn().mockResolvedValue([]),
      };
      capturedQb = qb;
      return qb;
    }),
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    increment: jest.fn(),
  };
  const noop = { find: jest.fn(), findOneBy: jest.fn(), save: jest.fn(), create: jest.fn(), remove: jest.fn() };

  beforeEach(async () => {
    capturedQb = null;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: getRepositoryToken(KnowledgeBase), useValue: noop },
        { provide: getRepositoryToken(Faq), useValue: mockFaqRepo },
        { provide: getRepositoryToken(KbSource), useValue: noop },
        { provide: getRepositoryToken(KbProtected), useValue: noop },
        { provide: FileParserService, useValue: { detectKind: jest.fn(), parse: jest.fn() } },
        { provide: EntityExtractorService, useValue: { extract: jest.fn(() => []) } },
        { provide: AiFaqGeneratorService, useValue: {} },
      ],
    }).compile();
    service = module.get<KnowledgeService>(KnowledgeService);
  });

  it('search() with new opts passes status=published filter into QueryBuilder', async () => {
    await service.search('hello', { tenantId: 't1', status: 'published' });
    expect(capturedQb).not.toBeNull();
    const conds = capturedQb._conditions;
    const hasStatusFilter = conds.some((c: any) =>
      c.clause.includes('faq.status') && c.params?.st === 'published',
    );
    expect(hasStatusFilter).toBe(true);
  });

  it('search() with language filter is applied', async () => {
    await service.search('hello', { tenantId: 't1', language: 'en', status: 'published' });
    const conds = capturedQb._conditions;
    const hasLangFilter = conds.some((c: any) =>
      c.clause.includes('faq.language') && c.params?.lang === 'en',
    );
    expect(hasLangFilter).toBe(true);
  });

  it('search() without opts only filters enabled — backward compatible', async () => {
    await service.search('hello');
    const conds = capturedQb._conditions;
    const hasStatusFilter = conds.some((c: any) => c.clause.includes('faq.status'));
    const hasLangFilter = conds.some((c: any) => c.clause.includes('faq.language'));
    expect(hasStatusFilter).toBe(false); // 老签名不强制 status, 由调用方 (Decider) 显式传
    expect(hasLangFilter).toBe(false);
  });

  it('search() legacy positional signature still works', async () => {
    // search(query, kbId, topN, tenantId)
    await service.search('hello', 'kb-123', 10, 'tenant-abc');
    const conds = capturedQb._conditions;
    const hasKb = conds.some((c: any) => c.clause.includes('faq.kbId') && c.params?.kbId === 'kb-123');
    const hasTenant = conds.some((c: any) => c.clause.includes('knowledge_bases') && c.params?.tid === 'tenant-abc');
    expect(hasKb).toBe(true);
    expect(hasTenant).toBe(true);
  });
});
