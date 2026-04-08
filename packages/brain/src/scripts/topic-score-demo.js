/**
 * topic-score-demo.js
 *
 * 选题热度评分模型 Demo（离线运行，无需数据库连接）。
 *
 * 展示 topic-heat-scorer.js 的核心评分逻辑：
 *   1. 热度公式：raw = views×0.1 + likes×3 + comments×5 + shares×7
 *   2. 归一化到 0-100
 *   3. 多话题对比排名
 *   4. 下周选题推荐决策
 *
 * 运行方式：
 *   node packages/brain/src/scripts/topic-score-demo.js
 */

// ─── 评分常量（与 topic-heat-scorer.js 保持一致）────────────────────────────

export const HEAT_WEIGHTS = {
  views: 0.1,
  likes: 3,
  comments: 5,
  shares: 7,
};

const MAX_RAW_SCORE = 1000;
const HIGH_HEAT_THRESHOLD = 60;

// ─── 核心评分函数（可独立测试）──────────────────────────────────────────────

/**
 * 计算单条话题的原始热度分。
 *
 * @param {{ views: number, likes: number, comments: number, shares: number }} metrics
 * @returns {number}
 */
export function calcRawHeatScore({ views = 0, likes = 0, comments = 0, shares = 0 }) {
  return (
    views * HEAT_WEIGHTS.views +
    likes * HEAT_WEIGHTS.likes +
    comments * HEAT_WEIGHTS.comments +
    shares * HEAT_WEIGHTS.shares
  );
}

/**
 * 归一化原始热度分到 0-100。
 *
 * @param {number} raw
 * @returns {number}
 */
export function normalizeHeatScore(raw) {
  return Math.min(Math.round((raw / MAX_RAW_SCORE) * 100 * 100) / 100, 100);
}

/**
 * 计算话题最终热度分（原始 → 归一化）。
 *
 * @param {{ views: number, likes: number, comments: number, shares: number }} metrics
 * @returns {{ raw: number, score: number, isHot: boolean }}
 */
export function scoreTopicEngagement(metrics) {
  const raw = calcRawHeatScore(metrics);
  const score = normalizeHeatScore(raw);
  return { raw, score, isHot: score >= HIGH_HEAT_THRESHOLD };
}

/**
 * 对多个话题排名，返回按热度分降序排列的列表。
 *
 * @param {Array<{ keyword: string, metrics: object, publishCount?: number }>} topics
 * @returns {Array<{ keyword: string, score: number, raw: number, isHot: boolean, publishCount: number, rank: number }>}
 */
export function rankTopics(topics) {
  return topics
    .map(({ keyword, metrics, publishCount = 1 }) => ({
      keyword,
      publishCount,
      ...scoreTopicEngagement(metrics),
    }))
    .sort((a, b) => b.score - a.score)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

// ─── Demo 数据（模拟真实平台采集结果）────────────────────────────────────────

// 模拟早期账号真实量级（小号初期，views 百~千级）
// MAX_RAW_SCORE=1000 时的参考：
//   raw=1000 → score=100 | raw=600 → score=60 | raw=300 → score=30
const DEMO_TOPICS = [
  {
    keyword: 'AI一人公司',
    publishCount: 8,
    metrics: { views: 2800, likes: 96, comments: 42, shares: 28 },
    // raw ≈ 280+288+210+196 = 974 → ~97分
  },
  {
    keyword: '副业变现',
    publishCount: 5,
    metrics: { views: 1900, likes: 68, comments: 28, shares: 18 },
    // raw ≈ 190+204+140+126 = 660 → ~66分
  },
  {
    keyword: '独立开发者',
    publishCount: 6,
    metrics: { views: 1500, likes: 52, comments: 22, shares: 14 },
    // raw ≈ 150+156+110+98 = 514 → ~51分
  },
  {
    keyword: '工具效率',
    publishCount: 4,
    metrics: { views: 900, likes: 30, comments: 10, shares: 6 },
    // raw ≈ 90+90+50+42 = 272 → ~27分
  },
  {
    keyword: 'AI写作',
    publishCount: 7,
    metrics: { views: 2200, likes: 78, comments: 35, shares: 22 },
    // raw ≈ 220+234+175+154 = 783 → ~78分
  },
  {
    keyword: '流量变现',
    publishCount: 3,
    metrics: { views: 600, likes: 18, comments: 6, shares: 4 },
    // raw ≈ 60+54+30+28 = 172 → ~17分
  },
  {
    keyword: '内容创业',
    publishCount: 5,
    metrics: { views: 1300, likes: 44, comments: 18, shares: 11 },
    // raw ≈ 130+132+90+77 = 429 → ~43分
  },
];

// ─── Demo 主函数 ─────────────────────────────────────────────────────────────

export function runDemo(topics = DEMO_TOPICS) {
  const ranked = rankTopics(topics);

  console.log('\n========================================');
  console.log('  选题热度评分模型 Demo');
  console.log('  Brain — topic-heat-scorer v1.0');
  console.log('========================================\n');

  console.log('📊 热度公式: raw = views×0.1 + likes×3 + comments×5 + shares×7');
  console.log(`   归一化基准: MAX_RAW=${MAX_RAW_SCORE}, 高热阈值: ${HIGH_HEAT_THRESHOLD}\n`);

  console.log('┌──────────────────┬──────┬──────────┬───────────┬──────────┐');
  console.log('│ 话题关键词       │ 排名 │ 热度分   │ 发布条数  │ 是否高热 │');
  console.log('├──────────────────┼──────┼──────────┼───────────┼──────────┤');

  for (const t of ranked) {
    const keyword = t.keyword.padEnd(16, '　');
    const rank = String(t.rank).padStart(4);
    const score = String(t.score.toFixed(1)).padStart(8);
    const count = String(t.publishCount).padStart(9);
    const hot = t.isHot ? '  🔥 高热  ' : '    —     ';
    console.log(`│ ${keyword} │${rank} │${score} │${count}  │${hot}│`);
  }

  console.log('└──────────────────┴──────┴──────────┴───────────┴──────────┘\n');

  const hotTopics = ranked.filter((t) => t.isHot);
  console.log(`🎯 高热话题（score ≥ ${HIGH_HEAT_THRESHOLD}）共 ${hotTopics.length} 个:`);
  hotTopics.forEach((t) => {
    console.log(`   #${t.rank} ${t.keyword} — ${t.score.toFixed(1)}分 (raw=${t.raw.toFixed(0)})`);
  });

  console.log('\n📌 下周选题建议（Top 3 高热话题优先）:');
  const top3 = ranked.slice(0, 3);
  top3.forEach((t, i) => {
    const tag = t.isHot ? '[高热]' : '[一般]';
    console.log(`   ${i + 1}. ${t.keyword} ${tag} — 推荐指数 ${t.score.toFixed(0)}/100`);
  });

  console.log('\n========================================\n');

  return ranked;
}

// ─── 直接运行 ─────────────────────────────────────────────────────────────────

// 检测是否直接运行（ESM 环境）
const isMain = process.argv[1]?.endsWith('topic-score-demo.js');
if (isMain) {
  runDemo();
}
