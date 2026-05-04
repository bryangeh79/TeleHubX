/**
 * Codex round-8 minimal unit tests.
 * 仅测纯函数 normalize helpers, 不依赖 DB / GramJS / 任何 IO.
 */
import { normalizePhone, normalizeUsername } from './campaign-dispatch.service';

describe('normalizeUsername', () => {
  it('strips @ prefix', () => {
    expect(normalizeUsername('@alice')).toBe('alice');
  });
  it('lowercases mixed case', () => {
    expect(normalizeUsername('Alice')).toBe('alice');
    expect(normalizeUsername('@AliceWonder')).toBe('alicewonder');
  });
  it('trims whitespace', () => {
    expect(normalizeUsername('  @alice  ')).toBe('alice');
  });
  it('empty / unusual inputs', () => {
    expect(normalizeUsername('')).toBe('');
    expect(normalizeUsername('@')).toBe('');
  });
});

describe('normalizePhone', () => {
  it('strips + prefix', () => {
    expect(normalizePhone('+60123456789')).toBe('60123456789');
  });
  it('strips spaces', () => {
    expect(normalizePhone('60 123 456 789')).toBe('60123456789');
  });
  it('strips dashes', () => {
    expect(normalizePhone('+60-123-456-789')).toBe('60123456789');
  });
  it('mixed separators', () => {
    expect(normalizePhone('+60 123-456 789')).toBe('60123456789');
  });
  it('already normalized', () => {
    expect(normalizePhone('60123456789')).toBe('60123456789');
  });
  it('non-digit garbage stripped', () => {
    expect(normalizePhone('+1 (650) 555-1234')).toBe('16505551234');
  });
});

describe('candidate matching scenarios (integration shape)', () => {
  // 模拟候选池入库 vs campaign target 几种格式不一致, 经 normalize 后都能匹配
  it.each([
    ['@Alice', 'alice'],          // dispatch target @Alice ↔ candidate.tgUsername=alice
    ['Alice', 'ALICE'],           // 大小写不一
    ['@bob_2024', 'bob_2024'],    // dispatch 带 @ candidate 不带
  ])('username %s ↔ %s after normalize', (target, candidate) => {
    expect(normalizeUsername(target)).toBe(normalizeUsername(candidate));
  });

  it.each([
    ['+60123456789', '60123456789'],
    ['+60 123 456 789', '60-123-456-789'],
    ['60 123 456 789', '+60123456789'],
  ])('phone %s ↔ %s after normalize', (target, candidate) => {
    expect(normalizePhone(target)).toBe(normalizePhone(candidate));
  });
});
