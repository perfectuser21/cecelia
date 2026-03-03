/**
 * Pending Conversations — Cecelia 的待回音追踪系统
 *
 * Cecelia 说了话之后，把这条消息记录下来，等着 Alex 的回音。
 * 每次 tick 检查：发出多久了？收到回应了吗？要不要跟进？
 *
 * 跟进决策用概率机制（非硬阈值），模拟自然的社交节奏：
 *   shouldFollowUp = (importance + urgencyBonus) > Math.random()
 *   urgencyBonus = min(hoursElapsed / 8, 0.3)  — 沉默越久，动机越强
 *   这样高优先级消息更容易被跟进，低优先级有随机性，不像机器人
 *
 * 参考：ComPeer (UIST 2024) — 用重要性分数 vs 随机数决定是否主动发送
 */

/* global console */

const MAX_FOLLOWUP_COUNT = 3;          // 最多跟进次数（避免骚扰）
const MIN_FOLLOWUP_INTERVAL_HOURS = 1; // 两次跟进之间的最短间隔

/**
 * 记录 Cecelia 发出的消息（待回音）
 *
 * @param {Object} pool
 * @param {string} message - Cecelia 说了什么
 * @param {Object} [options]
 * @param {string} [options.personId='owner']
 * @param {string} [options.context] - 为什么说（任务完成描述 / 欲望驱动原因）
 * @param {string} [options.contextType='other'] - task_completion / desire / followup / proactive / other
 * @param {number} [options.importance=0.5] - 0.0~1.0，影响跟进概率
 * @returns {Promise<string|null>} - 新记录的 id
 */
export async function recordOutbound(pool, message, options = {}) {
  const {
    personId = 'owner',
    context = null,
    contextType = 'other',
    importance = 0.5
  } = options;

  try {
    const { rows } = await pool.query(
      `INSERT INTO pending_conversations
         (person_id, message, context, context_type, importance, sent_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [personId, message, context, contextType, importance]
    );
    return rows[0]?.id || null;
  } catch (err) {
    console.warn('[pending-conversations] recordOutbound failed:', err.message);
    return null;
  }
}

/**
 * 标记消息已得到回应（resolved）
 *
 * @param {Object} pool
 * @param {string} personId
 * @param {string} [resolveSource='user_reply']
 */
export async function resolveByPersonReply(pool, personId = 'owner', resolveSource = 'user_reply') {
  try {
    const { rowCount } = await pool.query(
      `UPDATE pending_conversations
       SET resolved_at = NOW(), resolve_source = $2
       WHERE person_id = $1 AND resolved_at IS NULL`,
      [personId, resolveSource]
    );
    if (rowCount > 0) {
      console.log(`[pending-conversations] resolved ${rowCount} pending conversations for ${personId}`);
    }
  } catch (err) {
    console.warn('[pending-conversations] resolveByPersonReply failed:', err.message);
  }
}

/**
 * 判断是否应该跟进某条消息（概率机制）
 *
 * @param {Object} pendingConv - pending_conversations 行
 * @returns {boolean}
 */
export function shouldFollowUp(pendingConv) {
  // 已超过最大跟进次数
  if (pendingConv.followed_up_count >= MAX_FOLLOWUP_COUNT) return false;

  // 距上次跟进时间不足最短间隔
  if (pendingConv.last_followup_at) {
    const hoursSinceLastFollowup =
      (Date.now() - new Date(pendingConv.last_followup_at).getTime()) / (1000 * 3600);
    if (hoursSinceLastFollowup < MIN_FOLLOWUP_INTERVAL_HOURS) return false;
  }

  const hoursElapsed = (Date.now() - new Date(pendingConv.sent_at).getTime()) / (1000 * 3600);

  // 沉默越久，跟进动机越强（最多 +0.3）
  const urgencyBonus = Math.min(hoursElapsed / 8, 0.3);

  // 概率决策：(importance + urgencyBonus) > 随机阈值
  const threshold = Math.random();
  return (pendingConv.importance + urgencyBonus) > threshold;
}

/**
 * Tick 集成入口：检查所有待回音消息，决定是否跟进
 *
 * @param {Object} pool
 * @returns {Promise<Array>} - 需要跟进的消息列表
 */
export async function checkPendingFollowups(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pending_conversations
       WHERE resolved_at IS NULL
         AND followed_up_count < $1
       ORDER BY sent_at ASC`,
      [MAX_FOLLOWUP_COUNT]
    );

    if (rows.length === 0) return [];

    const toFollowUp = rows.filter(conv => shouldFollowUp(conv));

    if (toFollowUp.length === 0) return [];

    // 更新跟进计数
    const ids = toFollowUp.map(c => c.id);
    await pool.query(
      `UPDATE pending_conversations
       SET followed_up_count = followed_up_count + 1,
           last_followup_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    console.log(`[pending-conversations] ${toFollowUp.length} 条消息需要跟进`);
    return toFollowUp;
  } catch (err) {
    console.warn('[pending-conversations] checkPendingFollowups failed:', err.message);
    return [];
  }
}

/**
 * 查询某人的待回音消息（供状态展示用）
 * @param {Object} pool
 * @param {string} [personId='owner']
 * @returns {Promise<Array>}
 */
export async function getOpenConversations(pool, personId = 'owner') {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM pending_conversations
       WHERE person_id = $1 AND resolved_at IS NULL
       ORDER BY sent_at DESC
       LIMIT 20`,
      [personId]
    );
    return rows;
  } catch (err) {
    console.warn('[pending-conversations] getOpenConversations failed:', err.message);
    return [];
  }
}
