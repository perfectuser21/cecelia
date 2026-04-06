/**
 * Curiosity Scorer — 好奇心评分引擎
 *
 * 三维评分体系：
 *   1. 探索多样性 (40%)：本周探索了哪些不同领域？
 *   2. 发现质量   (40%)：探索产出的洞察数量与质量
 *   3. 行动转化   (20%)：探索建议被实际采纳的比例（已完成 research 任务占比）
 *
 * 存储：working_memory（key = 'curiosity_score'）
 * 触发：每次 research/curiosity 任务完成后
 */

import pool from './db.js';

// ── 权重 ────────────────────────────────────────────────────────────
const WEIGHT_DIVERSITY   = 0.40;
const WEIGHT_QUALITY     = 0.40;
const WEIGHT_CONVERSION  = 0.20;

// 本周时间范围（7天）
const WEEK_AGO_EXPR = `NOW() - INTERVAL '7 days'`;

// ── 维度 1：探索多样性 ────────────────────────────────────────────
/**
 * 统计本周探索任务覆盖的不同领域数量
 * 满分标准：≥5 个不同领域 → 100 分
 * @param {object} db
 * @returns {Promise<{score: number, detail: object}>}
 */
async function scoreDiversity(db) {
  const { rows } = await db.query(`
    SELECT
      COUNT(DISTINCT COALESCE(domain, 'unclassified')) AS unique_domains,
      COUNT(*) AS total_tasks,
      ARRAY_AGG(DISTINCT COALESCE(domain, 'unclassified')) AS domains
    FROM tasks
    WHERE (task_type = 'research' OR trigger_source = 'curiosity')
      AND created_at >= ${WEEK_AGO_EXPR}
  `);
  const row = rows[0] || {};
  const uniqueDomains = parseInt(row.unique_domains || 0);
  const totalTasks    = parseInt(row.total_tasks || 0);
  const domains       = row.domains || [];

  // 满分 = 5 个不同领域
  const MAX_DOMAINS = 5;
  const raw = totalTasks === 0 ? 0 : Math.min(uniqueDomains / MAX_DOMAINS, 1.0);
  const score = Math.round(raw * 100);

  return {
    score,
    detail: {
      unique_domains: uniqueDomains,
      total_tasks: totalTasks,
      domains,
      max_domains_for_full_score: MAX_DOMAINS,
    },
  };
}

// ── 维度 2：发现质量 ──────────────────────────────────────────────
/**
 * 统计本周来自好奇心/反刍的洞察数量
 * 满分标准：≥10 条洞察 → 100 分
 * @param {object} db
 * @returns {Promise<{score: number, detail: object}>}
 */
async function scoreQuality(db) {
  const { rows } = await db.query(`
    SELECT COUNT(*) AS insight_count
    FROM memory_stream
    WHERE (
      content LIKE '[反刍洞察]%'
      OR content LIKE '[反思洞察]%'
      OR source_type = 'curiosity_insight'
    )
    AND created_at >= ${WEEK_AGO_EXPR}
  `);
  const insightCount = parseInt(rows[0]?.insight_count || 0);

  // 满分 = 10 条洞察
  const MAX_INSIGHTS = 10;
  const raw = Math.min(insightCount / MAX_INSIGHTS, 1.0);
  const score = Math.round(raw * 100);

  return {
    score,
    detail: {
      insight_count: insightCount,
      max_insights_for_full_score: MAX_INSIGHTS,
    },
  };
}

// ── 维度 3：行动转化 ──────────────────────────────────────────────
/**
 * 统计本周探索任务的完成率
 * 满分标准：≥80% 完成率 → 100 分
 * @param {object} db
 * @returns {Promise<{score: number, detail: object}>}
 */
async function scoreConversion(db) {
  const { rows } = await db.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed
    FROM tasks
    WHERE (task_type = 'research' OR trigger_source = 'curiosity')
      AND created_at >= ${WEEK_AGO_EXPR}
  `);
  const total     = parseInt(rows[0]?.total || 0);
  const completed = parseInt(rows[0]?.completed || 0);

  if (total === 0) {
    return {
      score: 0,
      detail: { total: 0, completed: 0, completion_rate: 0 },
    };
  }

  const completionRate = completed / total;
  // 满分 = 80% 完成率
  const TARGET_RATE = 0.8;
  const raw = Math.min(completionRate / TARGET_RATE, 1.0);
  const score = Math.round(raw * 100);

  return {
    score,
    detail: {
      total,
      completed,
      completion_rate: Math.round(completionRate * 100) / 100,
      target_rate: TARGET_RATE,
    },
  };
}

// ── 主函数：计算并缓存评分 ────────────────────────────────────────
/**
 * 计算三维好奇心评分，并写入 working_memory 缓存
 * @param {object} [dbPool] - 可注入 db pool（测试用）
 * @returns {Promise<CuriosityScore>}
 */
export async function calculateCuriosityScore(dbPool) {
  const db = dbPool || pool;

  let diversity, quality, conversion;
  try {
    [diversity, quality, conversion] = await Promise.all([
      scoreDiversity(db),
      scoreQuality(db),
      scoreConversion(db),
    ]);
  } catch (err) {
    console.error('[curiosity-scorer] DB query failed:', err.message);
    // 返回上次缓存
    return getCachedScore(db);
  }

  // 加权求和
  const totalRaw =
    diversity.score  * WEIGHT_DIVERSITY +
    quality.score    * WEIGHT_QUALITY +
    conversion.score * WEIGHT_CONVERSION;

  const totalScore = Math.round(Math.min(Math.max(totalRaw, 0), 100));

  const result = {
    total_score:    totalScore,
    dimensions: {
      diversity:  { weight: WEIGHT_DIVERSITY,  ...diversity },
      quality:    { weight: WEIGHT_QUALITY,    ...quality },
      conversion: { weight: WEIGHT_CONVERSION, ...conversion },
    },
    calculated_at: new Date().toISOString(),
  };

  // 写入缓存
  try {
    await db.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ('curiosity_score', $1, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value_json = EXCLUDED.value_json,
            updated_at = NOW()
    `, [JSON.stringify(result)]);
  } catch (cacheErr) {
    console.warn('[curiosity-scorer] cache write failed (non-blocking):', cacheErr.message);
  }

  console.log(`[curiosity-scorer] score=${totalScore} (diversity=${diversity.score}, quality=${quality.score}, conversion=${conversion.score})`);
  return result;
}

// ── 读取缓存 ──────────────────────────────────────────────────────
/**
 * 读取 working_memory 中缓存的好奇心评分
 * 如果没有缓存，触发首次计算
 * @param {object} [dbPool]
 * @returns {Promise<CuriosityScore|null>}
 */
export async function getCachedScore(dbPool) {
  const db = dbPool || pool;
  try {
    const { rows } = await db.query(
      `SELECT value_json, updated_at FROM working_memory WHERE key = 'curiosity_score' LIMIT 1`
    );
    if (rows.length === 0) return null;
    const parsed = JSON.parse(rows[0].value_json);
    return { ...parsed, cached_at: rows[0].updated_at };
  } catch (err) {
    console.warn('[curiosity-scorer] cache read failed:', err.message);
    return null;
  }
}

/**
 * @typedef {object} CuriosityScore
 * @property {number} total_score - 总分 0-100
 * @property {object} dimensions - 三个维度的详细数据
 * @property {string} calculated_at - 计算时间 ISO 字符串
 */
