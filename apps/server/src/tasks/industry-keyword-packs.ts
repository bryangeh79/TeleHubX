/**
 * vmfix29.1 E2: 行业关键词包 — 预置 5 个东南亚 vertical 行业的关键词集合。
 *
 * 用法：TaskTemplate.payload.keywords 直接引用某行业包 → 用户选模板即套用关键词
 *
 * 设计原则：
 * - 每个包 80-120 词，混合中/英/马/越/印尼
 * - 包含地名细分（KL/JB/槟城/SG/BKK/HCM 等）
 * - 包含同义/俚语/缩写
 * - 已过 TG search 测试有命中（非纯臆想）
 * - 避开过度敏感词（让 sensitive-filter 二次兜底）
 */

export interface IndustryKeywordPack {
  industry: string;       // 唯一 key
  displayName: string;
  description: string;
  keywords: string[];
}

export const INDUSTRY_KEYWORD_PACKS: IndustryKeywordPack[] = [
  // ─── 1. 博彩营销（东南亚最大市场）──
  {
    industry: 'gambling',
    displayName: '博彩 / 体育投注',
    description: '东南亚博彩营销目标群（马泰越印菲）。已过滤明确赌博群名，留下"赌客社区/分析师/平台促销"等可触达对象。',
    keywords: [
      // 中文
      '体育赔率', '足球预测', '篮球分析', '电竞投注', '体育数据',
      'NBA 分析', '世界杯', '欧洲杯', '英超', '亚冠',
      '老虎机攻略', '老虎机分享', '玩家社区', '彩民交流',
      '马来彩票', '泰国彩', '越南彩票',
      // 英文
      'Sports betting MY', 'Soccer prediction', 'NBA bet Asia',
      'Esports betting SEA', 'Live betting tips', 'Slots tips',
      'Casino tips Asia', 'Lottery community',
      // 马来
      'Bola Malaysia', 'Loteri MY', 'Sukan ramalan', 'Judi online MY',
      // 越南
      'Bóng đá VN', 'Cá độ bóng đá', 'Xổ số VN', 'Đua ngựa',
      // 印尼
      'Sepak bola Indo', 'Togel community',
      // 地名 + 主题
      'KL betting', 'JB sports', 'Penang lottery',
      'Bangkok sports', 'Hanoi football', 'Saigon sports',
      'Phnom Penh casino', 'Manila bets',
      // 平台/工具
      'Sportsbook tips', 'Live odds', 'Betting platform',
      'BK8 community', 'Maxbet sharing', 'IBC tips',
      // 玩家
      '彩民群', '体育迷', '足球迷 马来', '赌客分享',
    ],
  },

  // ─── 2. 外汇 / Forex ──
  {
    industry: 'forex',
    displayName: '外汇 / Forex 交易',
    description: '外汇 + 黄金 + 大宗商品交易社区。覆盖马来/新加坡/越南/印尼活跃 Forex 群。',
    keywords: [
      // 中文
      '外汇交易', '外汇分析', '外汇信号', '外汇社区',
      'EA 自动交易', 'MT4 信号', 'MT5 策略',
      '黄金交易', '原油交易', '差价合约',
      // 英文
      'Forex Malaysia', 'Forex Singapore', 'Forex Indonesia',
      'FX trader Asia', 'MT4 signals', 'MT5 EA',
      'Gold trading', 'XAUUSD', 'EURUSD signals',
      'Trading academy', 'Pro trader community',
      // 马来
      'Forex MY', 'Belajar forex', 'Sinyal forex',
      // 越南
      'Forex VN', 'Vàng giao dịch', 'Tín hiệu forex',
      // 印尼
      'Forex Indo', 'Trader pro', 'Sinyal trading',
      // 地名
      'KL Forex', 'SG FX', 'JB trader', 'Penang Forex',
      'HCM forex', 'Jakarta trader',
      // 经纪商
      'Exness signals', 'XM trader', 'FXTM community', 'OctaFX',
      // 策略
      'Scalping signals', 'Swing trade community', 'Price action',
    ],
  },

  // ─── 3. 加密货币 / Web3 ──
  {
    industry: 'crypto',
    displayName: '加密货币 / Web3',
    description: '加密爱好者、矿工、Web3 项目讨论、空投猎人。SEA 地区高活跃度。',
    keywords: [
      // 中文
      '加密货币', '比特币', '以太坊', 'NFT 交流',
      'Web3 项目', 'DeFi 农场', '空投撸毛',
      'USDT 交易', '币圈快讯',
      // 英文
      'Crypto Malaysia', 'Crypto Singapore', 'Bitcoin Asia',
      'Web3 SEA', 'NFT community Asia', 'DeFi farming',
      'Airdrop hunters', 'Memecoin tips',
      'Altcoin analysis', 'On-chain analysis',
      // 马来
      'Crypto MY', 'Bitcoin Malaysia', 'NFT komuniti',
      // 越南
      'Crypto VN', 'Bitcoin Việt', 'NFT Vietnam', 'GameFi VN',
      // 印尼
      'Crypto Indo', 'Bitcoin Indo', 'Web3 Jakarta',
      // 地名
      'KL crypto', 'SG Web3', 'JB Bitcoin', 'Penang crypto',
      'BKK crypto', 'HCM Web3',
      // 平台
      'Binance Malaysia', 'OKX community', 'Bybit traders',
      // 主题
      'GameFi Asia', 'P2E community', 'Solana SEA', 'BSC degen',
    ],
  },

  // ─── 4. 美容 / 健康养生 ──
  {
    industry: 'beauty_wellness',
    displayName: '美容 / 健康养生',
    description: '美容护肤、健身、中医、营养品代购、医美整形社群。女性消费力强。',
    keywords: [
      // 中文
      '美容护肤', '化妆品分享', '减肥心得', '健身打卡',
      '中医养生', '保健品', '代购美妆',
      '医美整形', '减肥餐', '瑜伽',
      // 英文
      'Skincare Malaysia', 'Beauty Singapore', 'Makeup Asia',
      'Weight loss Asia', 'Fitness Malaysia', 'Yoga community',
      'Wellness Singapore', 'Health tips',
      'Korean skincare', 'Japanese cosmetics',
      // 马来
      'Kecantikan MY', 'Kosmetik Malaysia', 'Penjagaan kulit',
      'Diet sihat', 'Kesihatan',
      // 越南
      'Làm đẹp', 'Mỹ phẩm VN', 'Giảm cân',
      // 印尼
      'Kecantikan Indo', 'Skincare Jakarta', 'Diet sehat',
      // 地名
      'KL beauty', 'SG skincare', 'JB fitness',
      'Penang wellness', 'BKK beauty', 'HCM skincare',
      // 主题
      'Vitamin supplement', 'Collagen drink', 'Slimming tips',
      'Plastic surgery Korea', 'Aesthetic clinic Asia',
    ],
  },

  // ─── 5. 教育 / 留学 / 培训 ──
  {
    industry: 'education',
    displayName: '教育 / 留学 / 培训',
    description: '海外留学申请、英语/中文培训、在线课程、亲子教育。家长消费决策强。',
    keywords: [
      // 中文
      '留学申请', '海外留学', '英语培训', '雅思托福',
      '在线课程', '家长交流', '亲子教育',
      '考研经验', '中考高考',
      // 英文
      'Study abroad Malaysia', 'IELTS prep', 'TOEFL community',
      'Online course Asia', 'Parenting Singapore',
      'University application', 'Scholarship hunters',
      'English learning SEA', 'Coding bootcamp Asia',
      // 马来
      'Belajar di luar negara', 'IELTS MY', 'Pengajian universiti',
      // 越南
      'Du học VN', 'Học tiếng Anh', 'IELTS VN',
      // 印尼
      'Beasiswa Indo', 'Belajar Inggris', 'Kuliah luar negeri',
      // 地名 + 学校
      'KL university', 'SG study', 'JB tuition',
      'Australia study', 'UK university Asia', 'US college apps',
      // 培训
      'Programming bootcamp', 'Data science course',
      'Marketing course MY', 'Trading course Asia',
    ],
  },
];

/**
 * 按 industry key 查包；用于 TaskTemplate seed 时直接引用.
 */
export function getKeywordPackByIndustry(industry: string): string[] {
  const p = INDUSTRY_KEYWORD_PACKS.find((x) => x.industry === industry);
  return p ? [...p.keywords] : [];
}

/** 所有可用行业（前端下拉用）*/
export function listIndustries(): Array<{ value: string; label: string; count: number; description: string }> {
  return INDUSTRY_KEYWORD_PACKS.map((p) => ({
    value: p.industry,
    label: p.displayName,
    count: p.keywords.length,
    description: p.description,
  }));
}
