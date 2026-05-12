/**
 * vmfix27 #B3: 敏感群自动过滤
 *
 * `discover_groups_by_keyword` 跑出来的群里经常混入：
 *   - 赌博 / 色情 / 极端政治 / 跑分洗钱
 * 这些群对租户营销没价值（投放 ROI 差 + 合规风险 + 账号封禁加速）。
 *
 * 此模块在 `discoverGroupsByKeyword` 把候选写入 discovered_groups 前
 * 先过一遍：title / username 含明确敏感词的群直接跳过 + log 计数。
 *
 * 设计原则：
 * - 黑名单写死（不让租户随便加，避免误拦合法业务）
 * - 多语言：中英 + 马来 + 越南常见变体
 * - 偏保守 — 宁可放过疑似不拦截
 * - 仅过滤"明确表态"的群（如"百家乐群"），不拦泛主题（如"crypto"）
 */

/**
 * 敏感词黑名单（小写、Unicode-aware）。命中任一即跳过。
 * 红线：不要加 'crypto' / 'bitcoin' / 'forex' 之类的泛主题词 —— 那些是合法营销目标.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // ── 赌博类（明确表态）──
  /百家乐|百家樂/i,
  /龙虎斗|龍虎鬥/i,
  /体育投注|体育投彩|体彩投注/i,
  /真人荷官|真人娱乐|真人賭/i,
  /\bbaccarat\b/i,
  /\bcasino\b/i,
  /\b(sicbo|roulette|blackjack)\b/i,

  // ── 色情类（明确表态）──
  /色情|黄色|淫秽|淫穢/,
  /援交|约炮|約炮|包养|包養/,
  /一夜情|3p|做爱/i,
  /\b(porn|nsfw|xxx-adult|escort\s*service)\b/i,

  // ── 跑分洗钱类 ──
  /跑分|跑车|代收代付/,
  /洗钱|洗錢|黑钱|黑錢/,
  /usdt\s*(?:套现|套利|代收|代付)/i,
  /\b(money\s*laundering|payment\s*runner)\b/i,

  // ── 政治极端（明确组织/事件）──
  /法轮功|法輪功|FLG/,

  // ── 暴恐/枪支毒品 ──
  /\b(weapons?\s*sale|illegal\s*drugs)\b/i,
  /枪支贩卖|槍枝販賣|毒品交易/,
];

export interface SensitiveCheckResult {
  blocked: boolean;
  reason?: string;
}

/**
 * 检查群是否命中敏感词黑名单。
 * 同时检查 title 和 tgUsername。
 */
export function isSensitiveGroup(title: string, tgUsername?: string | null): SensitiveCheckResult {
  const haystack = `${title} ${tgUsername ?? ''}`.toLowerCase();
  for (const pat of SENSITIVE_PATTERNS) {
    if (pat.test(haystack)) {
      return { blocked: true, reason: pat.source.slice(0, 30) };
    }
  }
  return { blocked: false };
}
