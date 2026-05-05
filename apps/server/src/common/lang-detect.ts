/**
 * 轻量客户语言识别 (Issue #2 Round 2).
 *
 * 设计原则:
 *   - 纯规则, 不调用 AI (BotGateway 客户消息高频路径, 任何 AI 调用都浪费 token)
 *   - 支持: zh / en / ms / vi
 *   - 优先级: zh (CJK) > vi (越南语重音) > ms (马来文常见词) > en (拉丁字母默认) > fallback
 *
 * 返回 null 表示无法识别 — 调用方应 fallback 到 contentDefaultLanguage.
 */

export type DetectableLang = 'zh' | 'en' | 'ms' | 'vi';

// 越南语特有 Unicode 字符: 重音元音 (ăâđêôơư + tones)
// 用 Unicode 范围检测, 比"列举所有字符"更可靠.
//   - 0x00C0–0x024F: Latin Extended (含越南所有重音字符)
//   - 越南独有 đ Đ (0x0111 / 0x0110), ă Ă (0x0103 / 0x0102), ơ Ơ (0x01A1 / 0x01A0),
//     ư Ư (0x01B0 / 0x01AF) — 这些字符在 ms/en 中极少
const VI_DISTINCTIVE_RE = /[ăâđêôơưĂÂĐÊÔƠƯ]|[àáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ]/i;

// 马来文常见词 (用空格分隔的小写词词典). 命中 2 个或以上才认定为 ms,
// 单个词 (如 "ada") 在英文里也存在.
const MS_COMMON_WORDS = new Set([
  'yang', 'dan', 'untuk', 'dengan', 'adalah', 'tidak', 'akan', 'dari', 'pada', 'oleh',
  'ini', 'itu', 'kepada', 'dalam', 'boleh', 'sila', 'terima', 'kasih', 'apa', 'siapa',
  'bagaimana', 'mengapa', 'bila', 'dimana', 'macam', 'mana', 'saya', 'awak', 'kamu',
  'mereka', 'kita', 'kami', 'sudah', 'belum', 'hari', 'sekarang', 'nak', 'tak', 'lah',
  'ya', 'tidak', 'baik', 'bagus', 'harga', 'beli', 'jual', 'duit', 'wang', 'ringgit',
]);

// 越南文常见词 (兜底, 如果重音字符没出现 — 比如客户全用无声调拼写)
const VI_COMMON_WORDS = new Set([
  'tôi', 'toi', 'bạn', 'ban', 'anh', 'chị', 'chi', 'em', 'không', 'khong',
  'có', 'co', 'là', 'la', 'và', 'va', 'với', 'voi', 'của', 'cua',
  'cho', 'này', 'nay', 'đó', 'do', 'rồi', 'roi', 'được', 'duoc',
  'giá', 'gia', 'mua', 'bán', 'ban', 'tiền', 'tien', 'cảm', 'cam', 'ơn', 'on',
]);

const CJK_RE = /[一-鿿㐀-䶿]/;

/**
 * 检测文本主导语言. 短文本/无法判定返回 null.
 */
export function detectCustomerLanguage(text: string): DetectableLang | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. 中文字符 → zh (即使有英文混入, 主流亚洲客户场景以 CJK 字符为信号)
  if (CJK_RE.test(trimmed)) return 'zh';

  // 2. 越南语重音字符 → vi
  if (VI_DISTINCTIVE_RE.test(trimmed)) return 'vi';

  // 3. 词典命中: 拆词后查 ms / vi 词典
  const words = trimmed
    .toLowerCase()
    .split(/[\s,.。，！？!?;:'"()\[\]{}]+/)
    .filter(Boolean);
  if (!words.length) return null;

  let msHits = 0;
  let viHits = 0;
  for (const w of words) {
    if (MS_COMMON_WORDS.has(w)) msHits++;
    if (VI_COMMON_WORDS.has(w)) viHits++;
  }

  // ≥2 词命中 (避免 "ada" 这种 ms/en 共有词单独触发)
  if (msHits >= 2 && msHits > viHits) return 'ms';
  if (viHits >= 2 && viHits > msHits) return 'vi';

  // 4. 拉丁字母为主 → en (兜底)
  // 至少要有一个拉丁字母, 且字母占比超过总字符的 30%
  const latinCount = (trimmed.match(/[a-zA-Z]/g) ?? []).length;
  const totalNonSpace = trimmed.replace(/\s/g, '').length;
  if (totalNonSpace > 0 && latinCount / totalNonSpace >= 0.3) {
    return 'en';
  }

  // 5. 无法判断 (纯数字 / 纯标点 / emoji 等)
  return null;
}

/**
 * Resolve final reply language.
 *
 * Priority:
 *   1. settings.customerReplyLanguage != 'auto' → use it directly
 *   2. detectCustomerLanguage(messageText)
 *   3. settings.contentDefaultLanguage
 *   4. 'zh' (system default)
 */
export function resolveReplyLanguage(opts: {
  messageText: string;
  customerReplyLanguage?: string | null;   // auto / zh / en / ms / vi
  contentDefaultLanguage?: string | null;  // zh / en / ms / vi
}): DetectableLang {
  const { messageText, customerReplyLanguage, contentDefaultLanguage } = opts;

  // 1. 显式设置 (非 auto)
  if (
    customerReplyLanguage &&
    customerReplyLanguage !== 'auto' &&
    isDetectableLang(customerReplyLanguage)
  ) {
    return customerReplyLanguage;
  }

  // 2. 自动检测
  const detected = detectCustomerLanguage(messageText);
  if (detected) return detected;

  // 3. 租户内容默认
  if (contentDefaultLanguage && isDetectableLang(contentDefaultLanguage)) {
    return contentDefaultLanguage;
  }

  // 4. 系统默认
  return 'zh';
}

function isDetectableLang(s: string): s is DetectableLang {
  return s === 'zh' || s === 'en' || s === 'ms' || s === 'vi';
}

/** 给 AI prompt 用的语言名 (英文表达, AI 容易理解). */
export function langDisplayName(lang: DetectableLang): string {
  switch (lang) {
    case 'zh': return 'Chinese (中文)';
    case 'en': return 'English';
    case 'ms': return 'Bahasa Melayu (Malay)';
    case 'vi': return 'Tiếng Việt (Vietnamese)';
  }
}
