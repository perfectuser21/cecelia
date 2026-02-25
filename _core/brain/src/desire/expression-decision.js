/**
 * Layer 5: 表达决策层（Expression Decision）
 *
 * 每次 tick 扫描 pending desires，综合评分决定是否表达。
 * 评分公式：urgency(30%) × kr_relevance(20%) × impact(20%) × time_sensitivity(15%) × silence_penalty(15%)
 * silence_penalty = min(hours_since_last_feishu / 24, 1)
 * 评分 > 0.6 触发表达。
 */

const EXPRESSION_THRESHOLD = 0.6;

/**
 * 计算综合表达评分
 * @param {Object} desire - desires 表记录
 * @param {number} hoursSinceFeishu - 距上次 Feishu 消息的小时数
 * @returns {number} 0-1 评分
 */
function calculateExpressionScore(desire, hoursSinceFeishu) {
  const urgency = (desire.urgency / 10) * 0.30;

  // kr_relevance: warn/propose 与 KR 相关度更高
  const krRelevanceMap = { warn: 0.8, propose: 0.7, question: 0.6, inform: 0.5, celebrate: 0.4 };
  const krRelevance = (krRelevanceMap[desire.type] || 0.5) * 0.20;

  // impact: urgency >= 7 高影响
  const impact = (desire.urgency >= 7 ? 0.9 : desire.urgency >= 4 ? 0.6 : 0.3) * 0.20;

  // time_sensitivity: 接近过期时增大
  let timeSensitivity = 0.5;
  if (desire.expires_at) {
    const hoursUntilExpiry = (new Date(desire.expires_at).getTime() - Date.now()) / (1000 * 3600);
    if (hoursUntilExpiry < 2) timeSensitivity = 1.0;
    else if (hoursUntilExpiry < 6) timeSensitivity = 0.8;
    else if (hoursUntilExpiry < 12) timeSensitivity = 0.6;
  }
  const timeSensScore = timeSensitivity * 0.15;

  // silence_penalty: 沉默越久，门槛越低（分数越高）
  const silencePenalty = Math.min(hoursSinceFeishu / 24, 1) * 0.15;

  return urgency + krRelevance + impact + timeSensScore + silencePenalty;
}

/**
 * 扫描 pending desires，选出应该表达的
 * @param {import('pg').Pool} pool
 * @returns {Promise<{desire: Object, score: number} | null>}
 */
export async function runExpressionDecision(pool) {
  // 读取 hours_since_feishu
  let hoursSinceFeishu = 999;
  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'last_feishu_at'"
    );
    const lastFeishu = rows[0]?.value_json;
    if (lastFeishu) {
      hoursSinceFeishu = (Date.now() - new Date(lastFeishu).getTime()) / (1000 * 3600);
    }
  } catch (err) {
    console.error('[expression-decision] get last_feishu_at error:', err.message);
  }

  // 获取所有 pending desires（未过期）
  let desires = [];
  try {
    const { rows } = await pool.query(`
      SELECT id, type, content, insight, proposed_action, urgency, evidence, expires_at
      FROM desires
      WHERE status = 'pending'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY urgency DESC, created_at ASC
    `);
    desires = rows;
  } catch (err) {
    console.error('[expression-decision] fetch desires error:', err.message);
    return null;
  }

  if (desires.length === 0) return null;

  // 为每个 desire 计算评分，选最高分
  let best = null;
  let bestScore = 0;

  for (const desire of desires) {
    const score = calculateExpressionScore(desire, hoursSinceFeishu);
    if (score > bestScore) {
      bestScore = score;
      best = desire;
    }
  }

  if (!best || bestScore <= EXPRESSION_THRESHOLD) {
    return null;
  }

  return { desire: best, score: bestScore };
}
