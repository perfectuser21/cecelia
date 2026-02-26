/**
 * Layer 5: 表达决策层（Expression Decision）
 *
 * 每次 tick 扫描 pending desires，综合评分决定是否表达。
 * 评分公式：urgency(40%) + silence_penalty(30%) + user_online_boost(+0.15)
 * 阈值 0.35（降低，让日常 inform 也能发出来）。
 * act/follow_up 类型跳过评分直接通过（Cecelia 自主行动不需要门槛）。
 */

const EXPRESSION_THRESHOLD = 0.35;

/**
 * 计算综合表达评分（简化版，聚焦紧急度和沉默时长）
 * @param {Object} desire - desires 表记录
 * @param {number} hoursSinceExpression - 距上次表达的小时数
 * @param {boolean} userOnline - 用户是否在线
 * @returns {number} 0-1 评分
 */
function calculateExpressionScore(desire, hoursSinceExpression, userOnline = false) {
  // urgency 权重 40%
  const urgencyScore = (desire.urgency / 10) * 0.40;

  // silence_penalty 权重 30%：沉默越久越应该表达
  const silenceScore = Math.min(hoursSinceExpression / 24, 1) * 0.30;

  // kr_relevance 权重 15%
  const krRelevanceMap = { warn: 0.8, propose: 0.7, question: 0.6, act: 0.9, follow_up: 0.8, inform: 0.5, celebrate: 0.4 };
  const krRelevance = (krRelevanceMap[desire.type] || 0.5) * 0.15;

  // time_sensitivity 权重 15%
  let timeSensitivity = 0.5;
  if (desire.expires_at) {
    const hoursUntilExpiry = (new Date(desire.expires_at).getTime() - Date.now()) / (1000 * 3600);
    if (hoursUntilExpiry < 2) timeSensitivity = 1.0;
    else if (hoursUntilExpiry < 6) timeSensitivity = 0.8;
    else if (hoursUntilExpiry < 12) timeSensitivity = 0.6;
  }
  const timeSensScore = timeSensitivity * 0.15;

  let score = urgencyScore + silenceScore + krRelevance + timeSensScore;

  // 用户在线加分（Break 5：Alex 在时更主动）
  if (userOnline) score += 0.15;

  return Math.min(score, 1.0);
}

/**
 * 扫描 pending desires，选出应该表达的
 * @param {import('pg').Pool} pool
 * @returns {Promise<{desire: Object, score: number} | null>}
 */
export async function runExpressionDecision(pool) {
  // 读取 hours_since_expression（兼容旧 key last_feishu_at）
  let hoursSinceExpression = 999;
  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM working_memory WHERE key IN ('last_expression_at', 'last_feishu_at') ORDER BY updated_at DESC LIMIT 1"
    );
    const lastExpr = rows[0]?.value_json;
    if (lastExpr) {
      hoursSinceExpression = (Date.now() - new Date(lastExpr).getTime()) / (1000 * 3600);
    }
  } catch (err) {
    console.error('[expression-decision] get last_expression_at error:', err.message);
  }

  // 检查用户是否在线（Break 5）
  let userOnline = false;
  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'user_last_seen'"
    );
    const lastSeen = rows[0]?.value_json;
    if (lastSeen) {
      const minutesSince = (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60);
      userOnline = minutesSince < 5;
    }
  } catch (err) {
    console.error('[expression-decision] get user_last_seen error:', err.message);
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

  // act/follow_up 类型跳过评分直接通过（Break 3：Cecelia 自主行动）
  const actDesire = desires.find(d => d.type === 'act' || d.type === 'follow_up');
  if (actDesire) {
    return { desire: actDesire, score: 1.0 };
  }

  // 为每个 desire 计算评分，选最高分
  let best = null;
  let bestScore = 0;

  for (const desire of desires) {
    const score = calculateExpressionScore(desire, hoursSinceExpression, userOnline);
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
