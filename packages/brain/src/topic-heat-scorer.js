/**
 * topic-heat-scorer.js
 *
 * 选题热度评分引擎。
 *
 * 核心逻辑：
 *   1. 从 pipeline_publish_stats 聚合互动数据（views/likes/comments/shares）
 *   2. 通过 publish_task_id → tasks → payload 反向追溯所属话题关键词
 *   3. 按话题汇总，用加权公式计算热度分（归一化到 0-100）
 *   4. 将结果写入 topic_decision_feedback 表（下周选题参考）
 *
 * 热度公式：raw = views*0.1 + likes*3 + comments*5 + shares*7
 * 归一化：score = min(raw / MAX_RAW * 100, 100)
 *
 * 被调用方：
 *   - weekly-report-generator.js（周报"爆款主题"板块）
 *   - topic-selector.js（选题 Prompt 注入历史高热话题）
 */

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 热度公式各指标权重 */
export const HEAT_WEIGHTS = {
  views: 0.1,
  likes: 3,
  comments: 5,
  shares: 7,
};

/** 归一化基准分（raw 达到此值 = 100分） */
const MAX_RAW_SCORE = 1000;

/** 高热阈值（heat_score ≥ 此值视为高热话题） */
export const HIGH_HEAT_THRESHOLD = 60;

/** 查询近 N 周高热话题 */
const HIGH_HEAT_LOOKBACK_WEEKS = 4;

// ─── 热度计算 ─────────────────────────────────────────────────────────────────

/**
 * 计算单条记录的原始热度分（未归一化）。
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
 * 将原始热度分归一化到 0-100。
 *
 * @param {number} raw
 * @returns {number}
 */
export function normalizeHeatScore(raw) {
  return Math.min(Math.round((raw / MAX_RAW_SCORE) * 100 * 100) / 100, 100);
}

// ─── 数据查询 ─────────────────────────────────────────────────────────────────

/**
 * 聚合指定时间窗口内各话题的互动数据。
 *
 * 关联路径：
 *   pipeline_publish_stats.publish_task_id
 *   → tasks.id (content_publish)
 *   → tasks.payload->>'pipeline_id' / 'parent_pipeline_id'
 *   → tasks.id (content_pipeline) payload->>'topic' / 'keyword'
 *
 * @param {import('pg').Pool} pool
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<Array<{
 *   topic_keyword: string,
 *   total_views: number,
 *   total_likes: number,
 *   total_comments: number,
 *   total_shares: number,
 *   publish_count: number
 * }>>}
 */
export async function fetchTopicEngagementData(pool, start, end) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(
         cp.payload->>'topic',
         cp.payload->>'keyword',
         pub.payload->>'topic',
         pub.payload->>'keyword',
         '未分类'
       ) AS topic_keyword,
       COUNT(DISTINCT pps.publish_task_id)::int  AS publish_count,
       COALESCE(SUM(pps.views), 0)::bigint       AS total_views,
       COALESCE(SUM(pps.likes), 0)::bigint       AS total_likes,
       COALESCE(SUM(pps.comments), 0)::bigint    AS total_comments,
       COALESCE(SUM(pps.shares), 0)::bigint      AS total_shares
     FROM pipeline_publish_stats pps
     -- 发布任务
     LEFT JOIN tasks pub
       ON pub.id = pps.publish_task_id
     -- 上游 pipeline 任务（通过 pipeline_id 关联）
     LEFT JOIN tasks cp
       ON cp.id = COALESCE(
         (pub.payload->>'pipeline_id')::uuid,
         (pub.payload->>'parent_pipeline_id')::uuid
       )
       AND cp.task_type IN ('content_pipeline', 'content_generation', 'copywriting')
     WHERE pps.scraped_at >= $1
       AND pps.scraped_at < $2
     GROUP BY 1
     HAVING COALESCE(SUM(pps.views), 0) + COALESCE(SUM(pps.likes), 0) > 0
     ORDER BY (
       COALESCE(SUM(pps.views), 0) * 0.1 +
       COALESCE(SUM(pps.likes), 0) * 3 +
       COALESCE(SUM(pps.comments), 0) * 5 +
       COALESCE(SUM(pps.shares), 0) * 7
     ) DESC
     LIMIT 20`,
    [start, end]
  );

  return rows.map(r => ({
    topic_keyword: r.topic_keyword,
    total_views: Number(r.total_views),
    total_likes: Number(r.total_likes),
    total_comments: Number(r.total_comments),
    total_shares: Number(r.total_shares),
    publish_count: r.publish_count,
  }));
}

// ─── 主评分入口 ───────────────────────────────────────────────────────────────

/**
 * 计算指定时间窗口内各话题的热度评分，返回排序后的结果。
 *
 * @param {import('pg').Pool} pool
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<Array<{
 *   topic_keyword: string,
 *   heat_score: number,
 *   total_views: number,
 *   total_likes: number,
 *   total_comments: number,
 *   total_shares: number,
 *   publish_count: number
 * }>>}
 */
export async function computeTopicHeatScores(pool, start, end) {
  const topics = await fetchTopicEngagementData(pool, start, end);

  return topics.map(t => {
    const raw = calcRawHeatScore(t);
    const heat_score = normalizeHeatScore(raw);
    return { ...t, heat_score };
  }).sort((a, b) => b.heat_score - a.heat_score);
}

// ─── 写入反馈表 ───────────────────────────────────────────────────────────────

/**
 * 将本周话题热度结果写入 topic_decision_feedback 表。
 * 热度 TOP 3 自动标记 recommended_next_week = true。
 *
 * @param {import('pg').Pool} pool
 * @param {string} weekKey - YYYY-WNN
 * @param {Array<{ topic_keyword, heat_score, total_views, total_likes, total_comments, total_shares, publish_count }>} scoredTopics
 * @returns {Promise<number>} 写入行数
 */
export async function saveTopicFeedback(pool, weekKey, scoredTopics) {
  if (!scoredTopics || scoredTopics.length === 0) return 0;

  let saved = 0;
  const topKeywords = new Set(scoredTopics.slice(0, 3).map(t => t.topic_keyword));

  for (const t of scoredTopics) {
    try {
      await pool.query(
        `INSERT INTO topic_decision_feedback
           (week_key, topic_keyword, heat_score,
            total_views, total_likes, total_comments, total_shares,
            publish_count, recommended_next_week, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (week_key, topic_keyword) DO UPDATE SET
           heat_score            = EXCLUDED.heat_score,
           total_views           = EXCLUDED.total_views,
           total_likes           = EXCLUDED.total_likes,
           total_comments        = EXCLUDED.total_comments,
           total_shares          = EXCLUDED.total_shares,
           publish_count         = EXCLUDED.publish_count,
           recommended_next_week = EXCLUDED.recommended_next_week,
           updated_at            = NOW()`,
        [
          weekKey,
          t.topic_keyword,
          t.heat_score,
          t.total_views,
          t.total_likes,
          t.total_comments,
          t.total_shares,
          t.publish_count,
          topKeywords.has(t.topic_keyword),
        ]
      );
      saved++;
    } catch (err) {
      console.error(`[topic-heat-scorer] 写入反馈失败 (${t.topic_keyword}): ${err.message}`);
    }
  }

  return saved;
}

// ─── 历史高热话题查询（供 topic-selector 注入 Prompt）─────────────────────────

/**
 * 查询近 N 周内热度 ≥ HIGH_HEAT_THRESHOLD 的历史话题，用于下次选题参考。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{ topic_keyword: string, heat_score: number, week_key: string }>>}
 */
export async function getHighPerformingTopics(pool) {
  const { rows } = await pool.query(
    `SELECT topic_keyword, heat_score, week_key
     FROM topic_decision_feedback
     WHERE heat_score >= $1
       AND created_at >= NOW() - INTERVAL '${HIGH_HEAT_LOOKBACK_WEEKS} weeks'
     ORDER BY heat_score DESC, created_at DESC
     LIMIT 10`,
    [HIGH_HEAT_THRESHOLD]
  );
  return rows.map(r => ({
    topic_keyword: r.topic_keyword,
    heat_score: Number(r.heat_score),
    week_key: r.week_key,
  }));
}
