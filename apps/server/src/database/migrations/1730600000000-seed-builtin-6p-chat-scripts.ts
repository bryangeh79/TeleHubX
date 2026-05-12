import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 平台默认 6 人 (A-F) 聊天剧本 × 10 份 (中文).
 *
 * ⚠️ vmfix26 #15 起：本 migration 的种子数据已并行打成 JSON pack
 *    `data/script-packs/scripts_pack_6p_zh_v1.json` (packId='official_zh_6p_v1').
 *    JSON pack 走 `ChatScriptsService.onModuleInit()` 自动 import，
 *    在生产装包场景（`synchronize:true`，不跑 migration）下也能生效。
 *    本 migration 保留作 fallback，packId 不同 → 不会和 JSON pack 重复.
 *
 * tenantId=null → 平台共享, 所有租户可见 (executors 端 chat_script_6p 可直接抽取)
 * packId='_builtin_default_6p_v1' → 后续重跑/升级用此 key 识别已存在的种子, 跳过
 *
 * 设计原则:
 * - 每份剧本 12-15 轮, A-F 6 个角色都要参与 (至少各 1 轮)
 * - 每轮 1-2 个变体 (content_pool), 让每次执行随机抽不同文案
 * - send_delay_sec [30, 90] — 30-90 秒 Gaussian 间隔, 模拟真人打字节奏
 * - 全文本, 不用 voice/image/video, 跨容器无依赖
 * - 主题: 中性日常话题 (聚餐/电影/旅游/健身/读书/团建/咖啡/美食/吐槽/户外),
 *   广告号客服号都能用作群内活跃感剧本
 *
 * 红线: 必须 INSERT IF NOT EXISTS — 重跑 migration 不应创建重复记录.
 */
export class SeedBuiltin6pChatScripts1730600000000 implements MigrationInterface {
  name = 'SeedBuiltin6pChatScripts1730600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const PACK_ID = '_builtin_default_6p_v1';

    // 已种子过 → 跳过 (兼容多次 migration:run)
    const existing = await queryRunner.query(
      `SELECT COUNT(*)::int AS n FROM "chat_scripts" WHERE "packId" = $1`,
      [PACK_ID],
    );
    if (existing?.[0]?.n > 0) return;

    for (const script of SCRIPTS_FOR_SEED) {
      const lines = flattenToLines(script.rawScript);
      await queryRunner.query(
        `INSERT INTO "chat_scripts"
         ("tenantId", "name", "type", "minRound", "maxRound", "groupIds", "accountIds",
          "lines", "packId", "category", "rawScript", "status", "executedCount")
         VALUES (NULL, $1, $2, $3, $4, NULL, NULL, $5::jsonb, $6, $7, $8::jsonb, 'active', 0)`,
        [
          script.name,
          'A+B+C+D+E+F',
          script.minRound,
          script.maxRound,
          JSON.stringify(lines),
          PACK_ID,
          script.category,
          JSON.stringify(script.rawScript),
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "chat_scripts" WHERE "packId" = $1`,
      ['_builtin_default_6p_v1'],
    );
  }
}

/** 把 rawScript.sessions[].turns[] 摊平成 entity.lines 字段 (兼容旧查询). */
function flattenToLines(rawScript: any): any[] {
  const out: any[] = [];
  for (const sess of rawScript.sessions ?? []) {
    for (const t of sess.turns ?? []) {
      const text = (t.content_pool ?? [])[0] ?? '';
      out.push({
        roleLabel: t.role,
        text,
        allowEmoji: true,
        delayAfterMs: ((t.send_delay_sec ?? [30, 90])[0]) * 1000,
        delayStdDevMs: 5000,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 10 份 6 人剧本 — 每份 ~14 轮, 自然中文口语
// ─────────────────────────────────────────────────────────────────────

interface ScriptSeed {
  name: string;
  category: string;
  minRound: number;
  maxRound: number;
  rawScript: { sessions: Array<{ turns: Array<{ role: string; type: 'text'; content_pool: string[]; send_delay_sec: [number, number] }> }> };
}

function turn(role: string, ...variants: string[]): { role: string; type: 'text'; content_pool: string[]; send_delay_sec: [number, number] } {
  return { role, type: 'text', content_pool: variants, send_delay_sec: [30, 90] };
}

export const SCRIPTS_FOR_SEED: ScriptSeed[] = [
  // 1. 周末聚餐
  {
    name: 'A+B+C+D+E+F 剧本 #1 - 周末聚餐讨论',
    category: 'daily_gathering',
    minRound: 14,
    maxRound: 14,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '周末有空的吗 一起吃个饭呗', '周末聚一聚?好久没见了'),
          turn('B', '我可以啊 几点?', '周末有空 几个人?'),
          turn('C', '算我一个 吃啥?', '我也来 啥菜系?'),
          turn('D', '火锅吧 这天气适合', '川菜怎么样'),
          turn('E', '火锅+1', '都行 听你们的'),
          turn('F', '可以可以 哪家?', '哪家店?'),
          turn('A', '上次那家海底捞还行', '老地方海底捞?'),
          turn('B', '那家排队太久 换一家?', '海底捞最近人爆满'),
          turn('C', '楠火锅听说不错', '试试楠火锅?新开的'),
          turn('D', '行 楠火锅 几点?', '楠火锅可以 时间定了?'),
          turn('E', '六点半?', '六点半行不行'),
          turn('F', '六点半OK 我提前到去取号', '六点半 我先去排号'),
          turn('A', '辛苦辛苦 那就这么定了', '太好了 谢谢F'),
          turn('B', '到时见 别迟到啊', '不见不散'),
        ],
      }],
    },
  },

  // 2. 早晨咖啡
  {
    name: 'A+B+C+D+E+F 剧本 #2 - 早晨咖啡馆碰面',
    category: 'daily_morning',
    minRound: 13,
    maxRound: 13,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '早 你们都到了吗', '早安~ 我刚到楼下'),
          turn('B', '到了 在二楼靠窗', '我和C在二楼'),
          turn('C', '位置不错 你快上来', '上来吧 留了座'),
          turn('D', '我点单了 要啥?', '我帮大家点 喝啥?'),
          turn('A', '我要美式 谢谢', '一杯拿铁'),
          turn('E', '我到了 抱歉迟到', '刚下地铁 马上到'),
          turn('F', '我也到了 拿铁加燕麦奶', '点个燕麦拿铁'),
          turn('B', '今天聊啥?', '说正事吧'),
          turn('C', '上次那个项目进度?', '继续聊上次的'),
          turn('D', '咖啡来了 慢慢喝', '点好了 大家拿一下'),
          turn('A', '味道不错 这家豆子可以', '这咖啡比上次那家好'),
          turn('E', '环境也安静 适合聊事情', '人不多 挺舒服'),
          turn('F', '那开始正式聊?', '言归正传 我们开始'),
        ],
      }],
    },
  },

  // 3. 团建活动
  {
    name: 'A+B+C+D+E+F 剧本 #3 - 团建活动策划',
    category: 'team_building',
    minRound: 14,
    maxRound: 14,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '下个月团建 你们想去哪?', '团建讨论一下 有想法的吗'),
          turn('B', '提议去爬山 加烧烤', '户外活动+1'),
          turn('C', '爬山太累 室内剧本杀?', '玩剧本杀吧 6 个人正好'),
          turn('D', '剧本杀也行 但要选好店', '我支持剧本杀'),
          turn('E', '我两个都OK 听大家的', '都行 投票吧'),
          turn('F', '我倾向爬山 平时坐太久了', '运动一下也好'),
          turn('A', '剧本杀 vs 爬山 投票?', '那举手表决 剧本杀几票'),
          turn('B', '剧本杀1', '剧本杀+1'),
          turn('C', '剧本杀1', '我也剧本杀'),
          turn('D', '剧本杀1', '剧本杀'),
          turn('E', '爬山1', '我爬山'),
          turn('F', '爬山1', '爬山+1'),
          turn('A', '4票剧本杀胜出 我去订店', '那定剧本杀了 我联系商家'),
          turn('B', '搞定 期待', '辛苦A 谢谢'),
        ],
      }],
    },
  },

  // 4. 电影讨论
  {
    name: 'A+B+C+D+E+F 剧本 #4 - 看完新电影讨论',
    category: 'movie_review',
    minRound: 14,
    maxRound: 14,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '昨天看的那部电影怎么样', '看完了 来聊聊'),
          turn('B', '剧情拍得真不错', '我觉得很好看'),
          turn('C', '我也喜欢 节奏挺紧凑', '同感 没尿点'),
          turn('D', '后半段稍微有点拖', '结尾我没太看懂'),
          turn('E', '结尾留了悬念吧 等续集', '应该有续作'),
          turn('F', '配乐特别加分 我去找OST了', '原声很好听'),
          turn('A', '主演演技在线啊', '男主真的不错'),
          turn('B', '女主也很自然', '女演员也很在状态'),
          turn('C', '反派塑造得也好', '反派立体'),
          turn('D', '推荐给身边人吧', '值得二刷'),
          turn('E', '我打算带家人再看一次', '准备拉家人去看'),
          turn('F', 'IMAX 看效果更好', 'IMAX 的话画面更震撼'),
          turn('A', '总分我给 8 分', '我打 8.5'),
          turn('B', '8 分合理', '差不多 8 分到 9 分'),
        ],
      }],
    },
  },

  // 5. 旅游推荐
  {
    name: 'A+B+C+D+E+F 剧本 #5 - 旅游目的地分享',
    category: 'travel_share',
    minRound: 14,
    maxRound: 14,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '过年想出去玩 你们有推荐吗', '春节假期 有推荐的目的地吗'),
          turn('B', '云南啊 大理丽江都不错', '推荐云南 我去过两次'),
          turn('C', '我刚从西藏回来 风景绝了', '西藏强烈推荐'),
          turn('D', '出国不?日本性价比高', '考虑日本吗 现在汇率合适'),
          turn('E', '泰国也可以 物价友好', '泰国曼谷+清迈'),
          turn('F', '我倒想推荐新疆', '新疆冬天有滑雪'),
          turn('A', '云南我去过 想换个地方', '云南去过了'),
          turn('B', '那看你预算多少', '预算多少呢'),
          turn('C', '一万左右国内随便走', '一万的话国内够了'),
          turn('D', '日本一万也够 机票看时机', '日本提前订能很便宜'),
          turn('E', '决定了告诉我们 帮你做攻略', '定了说一声 一起做计划'),
          turn('F', '我有日本攻略可以发你', '我整理过日本路线'),
          turn('A', '太感谢了 我先和家人商量', '谢谢大家 我和家里再商量'),
          turn('B', '尽快决定 不然机票涨', '早点定 机票越拖越贵'),
        ],
      }],
    },
  },

  // 6. 健身打卡
  {
    name: 'A+B+C+D+E+F 剧本 #6 - 健身打卡分享',
    category: 'fitness_checkin',
    minRound: 13,
    maxRound: 13,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '今天有人去健身房吗', '今晚谁要去撸铁'),
          turn('B', '我下班直接过去', '我六点到'),
          turn('C', '我也去 练腿日', '今天练胸 一起?'),
          turn('D', '我今天休息 明天去', '今天休 大家加油'),
          turn('E', '我去做有氧 跑步机', '我跑步 不举铁'),
          turn('F', '一起一起 互相督促', '群里打卡互相监督'),
          turn('A', '本月目标减 3 公斤', '我目标体脂降到 18'),
          turn('B', '我增肌 5 公斤就行', '我想练块腹肌'),
          turn('C', '稳住饮食最重要', '管住嘴是关键'),
          turn('D', '少油少盐 多蛋白质', '我开始吃鸡胸了'),
          turn('E', '坚持就是胜利', '互相加油'),
          turn('F', '约个体测吧 月底', '月底称一次比比看'),
          turn('A', '行 月底见证奇迹', '到时候比一比'),
        ],
      }],
    },
  },

  // 7. 美食探店
  {
    name: 'A+B+C+D+E+F 剧本 #7 - 新店探店分享',
    category: 'food_explore',
    minRound: 14,
    maxRound: 14,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '街角新开的烧烤店 有人去过吗', '楼下那家新店去吃了吗'),
          turn('B', '昨天刚去 烤串挺嫩的', '我吃过一次 性价比高'),
          turn('C', '推荐什么菜?', '招牌是啥'),
          turn('D', '羊肉串和鸡翅必点', '招牌羊肉好吃'),
          turn('E', '环境怎么样 干净吗', '卫生 OK?'),
          turn('F', '挺干净的 装修也新', '环境可以 不油腻'),
          turn('A', '人均多少?', '价位贵不贵'),
          turn('B', '人均 80-100 吧', '一百块吃得很饱'),
          turn('C', '不算贵 周末约一波?', '可以 周末去'),
          turn('D', '+1 我请客', '我也想去'),
          turn('E', '需不需要预约', '要订位吗'),
          turn('F', '周末肯定要订 我去打电话', '我去预约位置'),
          turn('A', 'F 永远靠谱 谢谢', '谢谢 F'),
          turn('B', '到时见 期待', '不见不散'),
        ],
      }],
    },
  },

  // 8. 读书心得
  {
    name: 'A+B+C+D+E+F 剧本 #8 - 读书会心得分享',
    category: 'reading_share',
    minRound: 14,
    maxRound: 14,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '本月读书你们都看了啥', '这个月在看什么书'),
          turn('B', '《人类简史》 经典再读', '在看赫拉利的新书'),
          turn('C', '我看《被讨厌的勇气》', '看心理学方向的'),
          turn('D', '小说《活着》 太沉重', '余华的活着 看哭了'),
          turn('E', '在啃技术书 算不算', '在看专业书 ml 相关'),
          turn('F', '我看《思考快与慢》 烧脑', '丹尼尔的思考快与慢'),
          turn('A', '都很有深度 心得分享一下?', '聊聊感受'),
          turn('B', '人类简史的视角太宏大了', '看完世界观会变'),
          turn('C', '这本书让我反省自己的人际关系', '读完心态平和很多'),
          turn('D', '活着写的是命运 真的是命运', '书里每个人物都印象深刻'),
          turn('E', '技术书没啥可分享 哈哈', '工具书不展开了'),
          turn('F', '系统1系统2 这个概念太有用', '思考方式改变挺多'),
          turn('A', '下次推荐书目我整理下', '我做个书单整理给大家'),
          turn('B', '辛苦 期待书单', '谢谢A 整理'),
        ],
      }],
    },
  },

  // 9. 工作吐槽
  {
    name: 'A+B+C+D+E+F 剧本 #9 - 同行工作吐槽',
    category: 'work_chat',
    minRound: 13,
    maxRound: 13,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '今天加班吗 累死了', '今天又是加班的一天'),
          turn('B', '我已经麻木了', '同 麻了'),
          turn('C', '老板今天又开会到很晚', '会议太多了'),
          turn('D', 'KPI 还没完成 头大', '还有指标没赶完'),
          turn('E', '这周末估计也要加班', '估计周末又泡汤'),
          turn('F', '我已经开始找下家了', '在看新机会'),
          turn('A', '哪里招人 一起跳?', '有合适的留个坑'),
          turn('B', '我也想跳 但不敢', '想跳又怕'),
          turn('C', '现在行情不好 慎重', '跳槽要看时机'),
          turn('D', '内推群多看看 别裸辞', '不要裸辞 留好后路'),
          turn('E', '说的对 先骑驴找马', '骑驴找马最稳'),
          turn('F', '总之先撑过这季度', '熬一下年终再看'),
          turn('A', '一起加油 相互打气', '我们互相鼓励'),
        ],
      }],
    },
  },

  // 10. 周末户外
  {
    name: 'A+B+C+D+E+F 剧本 #10 - 周末户外活动',
    category: 'weekend_outdoor',
    minRound: 14,
    maxRound: 14,
    rawScript: {
      sessions: [{
        turns: [
          turn('A', '周末天气不错 户外走走?', '周末出去玩吗 天气好'),
          turn('B', '可以啊 去哪?', '想去哪儿'),
          turn('C', '提议骑行 沿江绿道', '骑车吧 沿江绿道'),
          turn('D', '骑行不错 我有自行车', '我自己有车'),
          turn('E', '我没车 可以租吗', '需要租车 哪里租'),
          turn('F', '美团上有 共享单车也行', '直接租美团的'),
          turn('A', '几点出发?', '约几点'),
          turn('B', '早上九点?天气不热', '九点出门 不晒'),
          turn('C', '九点可以 顺便吃早饭', '路上买点吃的'),
          turn('D', '记得带水和防晒', '别忘水 多喝水'),
          turn('E', '帽子也要带 防晒', '戴个帽子 不然晒黑'),
          turn('F', '我准备一个小急救包', '我带创可贴和酒精棉'),
          turn('A', 'F 永远 considerate 谢谢', 'F 太靠谱了'),
          turn('B', '约定 周六九点 江边集合', '周六九点见'),
        ],
      }],
    },
  },
];
