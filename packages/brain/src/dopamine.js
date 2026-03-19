/**
 * Dopamine / Reward Circuit — 多巴胺奖赏回路
 *
 * 记录任务完成/失败的奖赏信号，计算"满足感"分数，
 * 并在连续成功时强化习惯 pattern，影响 Self-Drive 的任务选择倾向。
 *
 * 写入：
 * - cecelia_events (event_type='reward_signal')
 * - brain_config (key='habit_patterns')
 */

import pool from './db.js';

// ─── 奖赏强度常量 ───────────────────────────────────────
const REWARD_INTENSITY = {
  task_completed: { P0: 1.0, P1: 0.7, P2: 0.5 },
  task_failed: -0.5,
  self_drive_success: 2.0, // 自驱任务成功 → 双倍基础奖赏
  probe_all_pass: 0.3,
};

// 习惯形成所需的连续成功次数
const HABIT_THRESHOLD = 3;

// 满足感衰减半衰期（小时）
const DECAY_HALF_LIFE_HOURS = 6;

/**
 * 记录一条奖赏信号
 *
 * @param {string} taskId - 关联的任务 ID（可为 null）
 * @param {'task_completed'|'task_failed'|'self_drive_success'|'probe_all_pass'} rewardType
 * @param {number} intensity - 奖赏强度（正=正向，负=惩罚）
 * @param {object} [meta={}] - 附加元数据（priority, taskType, skill 等）
 * @returns {Promise<{id: number, intensity: number}>}
 */
export async function recordReward(taskId, rewardType, intensity, meta = {}) {
  const payload = {
    task_id: taskId,
    reward_type: rewardType,
    intensity,
    ...meta,
  };

  const result = await pool.query(
    `INSERT INTO cecelia_events (event_type, source, payload)
     VALUES ('reward_signal', 'dopamine', $1::jsonb)
     RETURNING id`,
    [JSON.stringify(payload)]
  );

  // 如果是成功类奖赏，检查是否需要强化习惯 pattern
  if (
    (rewardType === 'task_completed' || rewardType === 'self_drive_success') &&
    meta.taskType &&
    meta.skill
  ) {
    await _checkAndReinforce(meta.taskType, meta.skill);
  }

  return { id: result.rows[0].id, intensity };
}

/**
 * 查询最近 N 小时的奖赏历史
 *
 * @param {number} [hours=24] - 回溯时间窗口
 * @returns {Promise<Array<{id: number, created_at: string, payload: object}>>}
 */
export async function getRewardHistory(hours = 24) {
  const { rows } = await pool.query(
    `SELECT id, created_at, payload
     FROM cecelia_events
     WHERE event_type = 'reward_signal'
       AND created_at >= NOW() - INTERVAL '1 hour' * $1
     ORDER BY created_at DESC`,
    [hours]
  );
  return rows;
}

/**
 * 计算当前"满足感"分数
 *
 * 算法：最近 24h 所有 reward_signal 的加权和，
 * 每条信号按时间衰减（距当前越远权重越低，半衰期 6h）。
 *
 * 返回值范围大致 -10 ~ +10（理论无上限），
 * Self-Drive 据此调整冒险倾向：
 *   score > 3  → 高满足感，可尝试新任务类型
 *   score 0~3  → 正常，按习惯选择
 *   score < 0  → 低满足感，优先做确定能成功的任务
 *
 * @returns {Promise<{score: number, count: number, breakdown: {positive: number, negative: number}}>}
 */
export async function getRewardScore() {
  const history = await getRewardHistory(24);

  let score = 0;
  let positive = 0;
  let negative = 0;

  const now = Date.now();

  for (const row of history) {
    const intensity = row.payload?.intensity ?? 0;
    const ageHours = (now - new Date(row.created_at).getTime()) / (1000 * 60 * 60);
    const decayFactor = Math.pow(0.5, ageHours / DECAY_HALF_LIFE_HOURS);
    const weighted = intensity * decayFactor;

    score += weighted;
    if (intensity > 0) positive += weighted;
    else negative += weighted;
  }

  return {
    score: Math.round(score * 100) / 100,
    count: history.length,
    breakdown: {
      positive: Math.round(positive * 100) / 100,
      negative: Math.round(negative * 100) / 100,
    },
  };
}

/**
 * 当某类任务连续成功达到阈值时，记录为习惯 pattern
 *
 * @param {string} taskType - 任务类型（如 'dev', 'review', 'content'）
 * @param {string} skill - 使用的技能（如 'dev', 'cto-review'）
 * @returns {Promise<boolean>} 是否形成新习惯
 */
export async function reinforcePattern(taskType, skill) {
  return _checkAndReinforce(taskType, skill);
}

// ─── 内部方法 ────────────────────────────────────────────

/**
 * 检查最近连续成功次数，达到阈值则写入 habit_patterns
 */
async function _checkAndReinforce(taskType, skill) {
  // 查询最近该类型的奖赏记录，判断是否连续成功
  const { rows } = await pool.query(
    `SELECT payload->>'reward_type' AS reward_type
     FROM cecelia_events
     WHERE event_type = 'reward_signal'
       AND payload->>'taskType' = $1
       AND payload->>'skill' = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [taskType, skill, HABIT_THRESHOLD]
  );

  // 需要足够数量且全部为成功类型
  if (rows.length < HABIT_THRESHOLD) return false;

  const allSuccess = rows.every(
    (r) => r.reward_type === 'task_completed' || r.reward_type === 'self_drive_success'
  );
  if (!allSuccess) return false;

  // 读取当前 habit_patterns
  const configResult = await pool.query(
    `SELECT value FROM brain_config WHERE key = 'habit_patterns'`
  );

  let patterns = {};
  if (configResult.rows.length > 0) {
    try {
      patterns = JSON.parse(configResult.rows[0].value);
    } catch {
      patterns = {};
    }
  }

  const patternKey = `${taskType}::${skill}`;
  const existing = patterns[patternKey];

  // 已存在且最近已记录过（1h 内），跳过重复写入
  if (existing && Date.now() - (existing.reinforced_at || 0) < 3600_000) {
    return false;
  }

  patterns[patternKey] = {
    taskType,
    skill,
    streak: (existing?.streak || 0) + HABIT_THRESHOLD,
    reinforced_at: Date.now(),
    formed_at: existing?.formed_at || Date.now(),
  };

  await pool.query(
    `INSERT INTO brain_config (key, value, updated_at)
     VALUES ('habit_patterns', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify(patterns)]
  );

  return true;
}

/**
 * 获取当前所有习惯 patterns（供 Self-Drive 读取）
 *
 * @returns {Promise<Record<string, {taskType: string, skill: string, streak: number}>>}
 */
export async function getHabitPatterns() {
  const { rows } = await pool.query(
    `SELECT value FROM brain_config WHERE key = 'habit_patterns'`
  );

  if (rows.length === 0) return {};

  try {
    return JSON.parse(rows[0].value);
  } catch {
    return {};
  }
}

/**
 * 初始化多巴胺事件监听器。
 * 监听 task_completed / task_failed 事件，自动记录奖赏信号。
 */
export function initDopamineListeners() {
  // 监听 cecelia_events 中的 task 完成/失败事件（通过定期扫描）
  const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟扫描一次新完成的任务
  let _lastScanTime = new Date();

  async function scanAndReward() {
    try {
      const result = await pool.query(
        `SELECT id, title, status, priority, task_type, trigger_source
         FROM tasks
         WHERE updated_at > $1
           AND status IN ('completed', 'failed')
         ORDER BY updated_at DESC LIMIT 20`,
        [_lastScanTime]
      );

      for (const task of result.rows) {
        if (task.status === 'completed') {
          const isSelfDrive = task.trigger_source === 'self_drive';
          const rewardType = isSelfDrive ? 'self_drive_success' : 'task_completed';
          const baseIntensity = REWARD_INTENSITY.task_completed[task.priority] || 0.5;
          const intensity = isSelfDrive ? baseIntensity * 2 : baseIntensity;
          await recordReward(task.id, rewardType, intensity, {
            title: task.title,
            task_type: task.task_type,
            priority: task.priority,
          });
          // 尝试强化习惯
          if (task.task_type) {
            await reinforcePattern(task.task_type, task.trigger_source || 'manual');
          }
        } else if (task.status === 'failed') {
          await recordReward(task.id, 'task_failed', REWARD_INTENSITY.task_failed, {
            title: task.title,
            task_type: task.task_type,
          });
        }
      }

      _lastScanTime = new Date();
    } catch (err) {
      console.warn(`[Dopamine] Scan error: ${err.message}`);
    }
  }

  // 启动后 1 分钟首次扫描
  setTimeout(() => {
    scanAndReward();
    setInterval(scanAndReward, SCAN_INTERVAL_MS);
  }, 60_000);

  console.log('[Dopamine] Listeners initialized (5min scan interval)');
}

export { REWARD_INTENSITY };
