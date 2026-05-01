/* eslint-disable */
/**
 * 生成 50 个 A+B+C+D 四人聊天剧本（中文 + 偶尔 emoji）→ data/script-packs/scripts_pack_4p_zh_v1.json
 *
 * 角色性格：
 *   A = 主动分享者（开话题、推荐、晒图）
 *   B = 理性分析者（质疑、对比、提建议）
 *   C = 好奇追问者（追细节、表赞同）
 *   D = 经验补充者（分享自己经历、收尾）
 *
 * 每剧本 12-16 turns，每 turn 4-5 个 content_pool 变体。
 *
 * 用法：node scripts/generate-4p-pack.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', '..', 'data', 'script-packs', 'scripts_pack_4p_zh_v1.json');

// ─── 50 个场景 ─────────────────────────────────────────────────────
const SCENARIOS = [
  { id: 's4p001', name: '群里推荐新餐厅', cat: 'food',          topic: '一家新开的餐厅' },
  { id: 's4p002', name: '周末聚会安排', cat: 'social',          topic: '周末聚会' },
  { id: 's4p003', name: '看到搞笑视频分享', cat: 'entertain',   topic: '一个搞笑视频' },
  { id: 's4p004', name: '老板加班吐槽', cat: 'work',            topic: '加班' },
  { id: 's4p005', name: '抢购优惠讨论', cat: 'shopping',        topic: '电商优惠' },
  { id: 's4p006', name: '咖啡店打卡', cat: 'food',              topic: '一家网红咖啡店' },
  { id: 's4p007', name: '出差攻略请教', cat: 'travel',          topic: '出差' },
  { id: 's4p008', name: '健身打卡分享', cat: 'health',          topic: '健身' },
  { id: 's4p009', name: '同事八卦', cat: 'work',                topic: '同事的八卦' },
  { id: 's4p010', name: '看新片影评', cat: 'entertain',         topic: '一部新电影' },
  { id: 's4p011', name: '旅游攻略问询', cat: 'travel',          topic: '一次旅游' },
  { id: 's4p012', name: '小孩教育讨论', cat: 'family',          topic: '小孩教育' },
  { id: 's4p013', name: '房地产话题', cat: 'finance',           topic: '房价' },
  { id: 's4p014', name: '股市行情', cat: 'finance',             topic: '股市' },
  { id: 's4p015', name: '早晨群问候', cat: 'daily_greeting',    topic: '早安' },
  { id: 's4p016', name: '雨天通勤', cat: 'daily_life',          topic: '下雨堵车' },
  { id: 's4p017', name: '节日祝福', cat: 'festival',            topic: '过节祝福' },
  { id: 's4p018', name: '团建讨论', cat: 'work',                topic: '公司团建' },
  { id: 's4p019', name: '吃货互相种草', cat: 'food',            topic: '美食推荐' },
  { id: 's4p020', name: '数码产品讨论', cat: 'shopping',        topic: '新款手机' },
  { id: 's4p021', name: '新书推荐', cat: 'study',               topic: '一本新书' },
  { id: 's4p022', name: '健身餐分享', cat: 'health',            topic: '健身餐' },
  { id: 's4p023', name: '周末约爬山', cat: 'social',            topic: '约爬山' },
  { id: 's4p024', name: '看球赛', cat: 'entertain',             topic: '球赛' },
  { id: 's4p025', name: '护肤心得', cat: 'shopping',            topic: '护肤品' },
  { id: 's4p026', name: '工作压力吐槽', cat: 'work',            topic: '工作压力' },
  { id: 's4p027', name: '装修话题', cat: 'family',              topic: '家里装修' },
  { id: 's4p028', name: '宠物分享', cat: 'family',              topic: '养宠物' },
  { id: 's4p029', name: '学习外语', cat: 'study',               topic: '学英语' },
  { id: 's4p030', name: '投资理财', cat: 'finance',             topic: '理财' },
  { id: 's4p031', name: '二手交易', cat: 'shopping',            topic: '二手物品' },
  { id: 's4p032', name: '求职互助', cat: 'work',                topic: '换工作' },
  { id: 's4p033', name: '外卖美食讨论', cat: 'food',            topic: '外卖' },
  { id: 's4p034', name: '创业话题', cat: 'work',                topic: '创业' },
  { id: 's4p035', name: '育儿心得', cat: 'family',              topic: '带小孩' },
  { id: 's4p036', name: '周年庆抢购', cat: 'shopping',          topic: '周年庆' },
  { id: 's4p037', name: '拼车讨论', cat: 'daily_life',          topic: '拼车' },
  { id: 's4p038', name: '周末追剧', cat: 'entertain',           topic: '一部新剧' },
  { id: 's4p039', name: '同学聚会', cat: 'social',              topic: '老同学聚会' },
  { id: 's4p040', name: '健康咨询', cat: 'health',              topic: '感冒生病' },
  { id: 's4p041', name: '演唱会票务', cat: 'entertain',         topic: '演唱会' },
  { id: 's4p042', name: '美容美发', cat: 'shopping',            topic: '换发型' },
  { id: 's4p043', name: '运动赛事', cat: 'entertain',           topic: '马拉松' },
  { id: 's4p044', name: '网络故障吐槽', cat: 'daily_life',      topic: '网速慢' },
  { id: 's4p045', name: '出差住宿讨论', cat: 'travel',          topic: '酒店' },
  { id: 's4p046', name: '早午餐预定', cat: 'food',              topic: 'brunch' },
  { id: 's4p047', name: '摄影分享', cat: 'entertain',           topic: '摄影作品' },
  { id: 's4p048', name: '阅读分享会', cat: 'study',             topic: '读书' },
  { id: 's4p049', name: '面试经历', cat: 'work',                topic: '面试' },
  { id: 's4p050', name: '退休规划', cat: 'finance',             topic: '退休' },
];

// ─── 通用变体池（按情境替换 {topic}） ─────────────────────────────
const POOLS = {
  // A 开场分享/抛话题
  a_opener: [
    '哎跟你们说 我今天发现 {topic} 这事儿',
    '群里有谁懂 {topic} 的 求教',
    '我跟你们聊聊 {topic} 哈',
    '突然想到一个事 关于 {topic} ✨',
    '🎉 大家来聊聊 {topic} 我有发现',
  ],
  a_share_detail: [
    '细节我慢慢说哈',
    '其实是这样的',
    '让我描述一下场景',
    '听完你们就懂了',
    '我先发个图',
  ],
  a_recommend: [
    '真心推荐 试试不亏',
    '我个人觉得挺值',
    '可以放心入',
    '比之前那个强多了 👍',
    '有空一定去看看',
  ],
  a_close: [
    '行 大概就这些',
    '改天再细聊 哈哈',
    '懂的都懂 不多说',
    '有问题随时问',
    '😄 不打扰你们了',
  ],

  // B 理性质疑/对比
  b_doubt: [
    '真的吗 不是营销吧 🤔',
    '我有点犹豫 听着像广告',
    '感觉夸大了 数据支撑呢',
    '不一定值 我先看看',
    '这种东西小心被坑',
  ],
  b_compare: [
    '和之前那个比呢',
    '价格差多少',
    '体验上有啥区别',
    '哪个性价比更高',
    '我列个对比表'
  ],
  b_suggestion: [
    '先观望一下 别冲动',
    '建议看几篇 review',
    '货比三家再决定',
    '稳一点 别冲',
    '研究清楚再下手 ✋',
  ],
  b_concede: [
    '嗯 你说得也对',
    '行吧 我服了',
    '👌 听你的',
    '那我也试试看',
    '🥲 算了 你说服我了',
  ],

  // C 好奇追问/赞同
  c_curious: [
    '哦？什么情况',
    '说说说 我感兴趣',
    '怎么个意思',
    '👀 详细讲讲',
    '欸我也想了解',
  ],
  c_followup: [
    '具体在哪',
    '什么时候的事',
    '价格多少呢',
    '我能加入吗',
    '怎么操作的',
  ],
  c_agree: [
    '我也是这样想',
    '+1',
    '同感同感',
    '对对对 👍',
    '我懂这种感觉',
  ],
  c_emoji: [
    '😂',
    '🤣',
    '👀',
    '🔥 牛',
    '🙌 666',
  ],

  // D 经验补充/收尾
  d_experience: [
    '我之前也碰到过类似的',
    '我有点话语权 我说说',
    '上次我也是这样 听我',
    '我朋友刚经历过',
    '😅 这个我太有经验了',
  ],
  d_tip: [
    '提醒一下 注意 X',
    '小贴士 来了 ⬇️',
    '过来人经验：别 rush',
    '我教你避坑',
    '记一下 关键点 ✨',
  ],
  d_close: [
    '大家小心 不踩坑就好',
    'ok 我先撤 改天聊',
    '群里多分享 互通有无',
    '靠谱的我都收藏 哈哈',
    '👋 不打扰你们了',
  ],
  d_emoji: [
    '👍',
    '💯',
    '🤝',
    '✨ 收到',
    '🌟 nice',
  ],
};

function fillTemplate(arr, ctx) {
  return arr.map((s) => s.replaceAll('{topic}', ctx.topic).replaceAll('{name}', ctx.name));
}

// ─── 单个剧本生成器 ─────────────────────────────────────────────
function makeScript(seed, idx) {
  const ctx = { topic: seed.topic, name: seed.name };

  // 12-16 turns，每个剧本 turn 数随机
  const totalTurns = 12 + ((idx * 7) % 5); // 12-16

  const turnPlan = [
    { role: 'A', pool: 'a_opener',       type: 'text' },
    { role: 'C', pool: 'c_curious',      type: 'text' },
    { role: 'A', pool: 'a_share_detail', type: 'text' },
    { role: 'B', pool: 'b_doubt',        type: 'text' },
    { role: 'D', pool: 'd_experience',   type: 'text' },
    { role: 'C', pool: 'c_followup',     type: 'text' },
    { role: 'A', pool: 'a_recommend',    type: 'text' },
    { role: 'B', pool: 'b_compare',      type: 'text' },
    { role: 'C', pool: 'c_agree',        type: 'text' },
    { role: 'D', pool: 'd_tip',          type: 'text' },
    { role: 'B', pool: 'b_suggestion',   type: 'text' },
    { role: 'A', pool: 'a_close',        type: 'text' },
    { role: 'C', pool: 'c_emoji',        type: 'text' },
    { role: 'D', pool: 'd_close',        type: 'text' },
    { role: 'B', pool: 'b_concede',      type: 'text' },
    { role: 'D', pool: 'd_emoji',        type: 'text' },
  ];

  const turns = [];
  for (let t = 0; t < totalTurns; t++) {
    const plan = turnPlan[t];
    const variants = fillTemplate(POOLS[plan.pool], ctx);
    turns.push({
      turn: t + 1,
      role: plan.role,
      type: plan.type,
      content_pool: variants,
      typing_delay_ms: [400, 1500],
      send_delay_sec: t === 0 ? [0, 0] : [15, 60],  // 节奏调快 (原 [30, 120])
    });
  }

  return {
    id: seed.id,
    name: seed.name,
    category: seed.cat,
    total_turns: totalTurns,
    min_warmup_stage: 2,
    ai_rewrite: true,
    safety: { max_daily_run_per_pair: 1, min_hours_between_runs: 24 },
    sessions: [{
      name: 'main',
      delay_from_start: '0h',
      turns,
    }],
  };
}

// ─── 输出 pack ─────────────────────────────────────────────────
const pack = {
  pack_id: 'official_zh_4p_v1',
  pack_name: '中文-4 人剧本包 v1',
  version: '1.0.0',
  language: 'zh',
  country: ['CN', 'MY', 'SG', 'TW', 'HK'],
  author: 'TeleHubX Official',
  total_scripts: SCENARIOS.length,
  description: '50 个 A+B+C+D 四人对话剧本，覆盖日常生活/工作/购物/娱乐/家庭等场景。每 turn 多变体，AI 优化兼容。',
  asset_pools_required: [
    'voices_casual_laugh',
    'voices_ok_casual',
    'images_food_general',
    'images_daily_life',
    'images_scenery',
  ],
  scripts: SCENARIOS.map((s, i) => makeScript(s, i)),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(pack, null, 2), 'utf-8');

const totalTurns = pack.scripts.reduce((sum, s) => sum + s.total_turns, 0);
const totalVariants = pack.scripts.reduce(
  (sum, s) => sum + s.sessions[0].turns.reduce((s2, t) => s2 + (t.content_pool?.length ?? 0), 0),
  0,
);
console.log(`Generated ${pack.scripts.length} scripts → ${OUT}`);
console.log(`Total turns: ${totalTurns}, total variants: ${totalVariants}`);
console.log(`Theoretical execution paths: ~5^${Math.round(totalTurns / pack.scripts.length)} per script × ${pack.scripts.length} scripts`);
