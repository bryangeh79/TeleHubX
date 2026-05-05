import { detectCustomerLanguage, resolveReplyLanguage } from './lang-detect';

describe('detectCustomerLanguage', () => {
  describe('zh', () => {
    const zhSamples = [
      '你好',
      '价格是多少？',
      '请问你们这边有什么产品',
      'hello 你好 world',  // mixed → zh wins (CJK present)
      '我想了解一下产品',
    ];
    for (const s of zhSamples) {
      it(`detects "${s}" as zh`, () => {
        expect(detectCustomerLanguage(s)).toBe('zh');
      });
    }
  });

  describe('vi', () => {
    const viSamples = [
      'Xin chào, tôi muốn hỏi giá',
      'Bạn có thể cho tôi biết',
      'Cảm ơn rất nhiều',
      'Sản phẩm này có tốt không',
      'tôi muốn mua', // 词典命中 (tôi + muốn)
    ];
    for (const s of viSamples) {
      it(`detects "${s}" as vi`, () => {
        expect(detectCustomerLanguage(s)).toBe('vi');
      });
    }
  });

  describe('ms', () => {
    const msSamples = [
      'Saya nak tanya harga produk ini',
      'Boleh saya tahu cara untuk beli',
      'Apa yang boleh saya lakukan',
      'Terima kasih untuk maklumat',
    ];
    for (const s of msSamples) {
      it(`detects "${s}" as ms`, () => {
        expect(detectCustomerLanguage(s)).toBe('ms');
      });
    }
  });

  describe('en', () => {
    const enSamples = [
      'Hello, how much is the price?',
      'Can I get more information about this product',
      'I would like to buy two units',
      'What are your business hours',
    ];
    for (const s of enSamples) {
      it(`detects "${s}" as en`, () => {
        expect(detectCustomerLanguage(s)).toBe('en');
      });
    }
  });

  describe('ambiguous / fallback', () => {
    it('returns null for empty', () => {
      expect(detectCustomerLanguage('')).toBeNull();
      expect(detectCustomerLanguage('   ')).toBeNull();
    });
    it('returns null for pure digits', () => {
      expect(detectCustomerLanguage('12345')).toBeNull();
    });
    it('returns null for emoji only', () => {
      expect(detectCustomerLanguage('😀😀😀')).toBeNull();
    });
    it('single ms word "ada" alone is NOT enough → en (latin majority)', () => {
      // single ms word is too weak signal — should fall back to en
      expect(detectCustomerLanguage('ada')).toBe('en');
    });
  });
});

describe('resolveReplyLanguage', () => {
  it('respects explicit customerReplyLanguage over detection', () => {
    expect(
      resolveReplyLanguage({
        messageText: '你好',
        customerReplyLanguage: 'en',
        contentDefaultLanguage: 'zh',
      }),
    ).toBe('en');
  });

  it('auto + zh message → zh', () => {
    expect(
      resolveReplyLanguage({
        messageText: '你好',
        customerReplyLanguage: 'auto',
        contentDefaultLanguage: 'en',
      }),
    ).toBe('zh');
  });

  it('auto + ambiguous → contentDefaultLanguage fallback', () => {
    expect(
      resolveReplyLanguage({
        messageText: '12345',
        customerReplyLanguage: 'auto',
        contentDefaultLanguage: 'ms',
      }),
    ).toBe('ms');
  });

  it('auto + ambiguous + no contentDefault → zh', () => {
    expect(
      resolveReplyLanguage({
        messageText: '😀',
        customerReplyLanguage: 'auto',
        contentDefaultLanguage: null,
      }),
    ).toBe('zh');
  });

  it('handles missing settings (legacy tenant)', () => {
    expect(
      resolveReplyLanguage({
        messageText: 'Cảm ơn',
        customerReplyLanguage: null,
        contentDefaultLanguage: null,
      }),
    ).toBe('vi');
  });

  it('invalid customerReplyLanguage value falls through to detection', () => {
    expect(
      resolveReplyLanguage({
        messageText: '你好',
        customerReplyLanguage: 'klingon' as any,
        contentDefaultLanguage: 'en',
      }),
    ).toBe('zh'); // detection wins because invalid value ignored
  });
});
