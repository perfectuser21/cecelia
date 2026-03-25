/**
 * Task Weight System - Dynamic Dispatch Priority Calculation
 *
 * Calculates comprehensive dispatch weight for tasks based on:
 * 1. Priority (P0/P1/P2) - base score
 * 2. Wait time (queued_at duration) - urgency bonus
 * 3. Retry count - escalation bonus
 * 4. Task type - type-specific adjustment
 * 5. RPE signal (Reward Prediction Error) - learning feedback
 *
 * Higher weight = dispatched first
 */

// Base scores by priority
const PRIORITY_BASE_SCORES = {
  'P0': 100,
  'P1': 60,
  'P2': 30,
  'default': 30
};

// Type adjustments (positive = boost, negative = penalty)
const TASK_TYPE_ADJUSTMENTS = {
  'initiative_plan': +20,    // Planning tasks are critical for unblocking work
  'initiative_verify': +15,  // Verification unblocks next initiative
  'dev': +10,                // Core development tasks get a boost
  'review': +5,              // Reviews should be timely
  'code_review': +5,
  'suggestion_plan': +5,
  'dept_heartbeat': -10,     // Heartbeats are low priority
  'data': -5,                // Data processing can wait
  'talk': 0,
  'qa': 0,
  'audit': 0,
  'research': 0,
  'explore': 0,
  'knowledge': 0,
  'codex_qa': 0,
  'decomp_review': 0
};

// Wait time bonus: +2 per hour queued, capped at +40 (20 hours)
const WAIT_BONUS_PER_HOUR = 2;
const WAIT_BONUS_MAX = 40;

// Retry bonus: +5 per retry, capped at +20 (4 retries)
const RETRY_BONUS_PER_COUNT = 5;
const RETRY_BONUS_MAX = 20;

// RPE bonus: scale factor applied to avg RPE, capped at ±10
// avg_rpe * RPE_SCALE_FACTOR → rpe_bonus range [-10, +10]
const RPE_SCALE_FACTOR = 10;
const RPE_BONUS_MAX = 10;
const RPE_BONUS_MIN = -10;

// 查询最近 N 条 rpe_signal 用于均值计算
const RPE_HISTORY_LIMIT = 20;

/**
 * Calculate dispatch weight for a task (synchronous, no RPE)
 *
 * @param {Object} task - Task object from database
 * @param {string} task.priority - Priority (P0/P1/P2)
 * @param {Date|string|null} task.queued_at - When task was queued
 * @param {number|null} task.retry_count - Number of retries (from payload or metadata)
 * @param {string|null} task.task_type - Task type
 * @returns {Object} Weight breakdown { weight, priority_score, wait_bonus, retry_bonus, type_adjustment, rpe_bonus, breakdown }
 */
function calculateTaskWeight(task) {
  if (!task || typeof task !== 'object') {
    return { weight: 0, priority_score: 0, wait_bonus: 0, retry_bonus: 0, type_adjustment: 0, rpe_bonus: 0, breakdown: 'invalid task' };
  }

  // 1. Priority base score
  const priority = (task.priority || 'default').toUpperCase();
  const priority_score = PRIORITY_BASE_SCORES[priority] ?? PRIORITY_BASE_SCORES['default'];

  // 2. Wait time bonus
  let wait_bonus = 0;
  const queuedAt = task.queued_at || task.created_at;
  if (queuedAt) {
    try {
      const queuedTime = new Date(queuedAt);
      const now = new Date();
      const hoursWaited = Math.max(0, (now - queuedTime) / (1000 * 60 * 60));
      wait_bonus = Math.min(
        Math.floor(hoursWaited * WAIT_BONUS_PER_HOUR),
        WAIT_BONUS_MAX
      );
    } catch (_e) {
      wait_bonus = 0;
    }
  }

  // 3. Retry count bonus (from payload.retry_count or task.retry_count)
  let retryCount = 0;
  if (typeof task.retry_count === 'number') {
    retryCount = task.retry_count;
  } else if (task.payload && typeof task.payload.retry_count === 'number') {
    retryCount = task.payload.retry_count;
  } else if (task.metadata && typeof task.metadata.retry_count === 'number') {
    retryCount = task.metadata.retry_count;
  }
  const retry_bonus = Math.min(
    Math.max(0, retryCount) * RETRY_BONUS_PER_COUNT,
    RETRY_BONUS_MAX
  );

  // 4. Task type adjustment
  const taskType = (task.task_type || '').toLowerCase();
  const type_adjustment = TASK_TYPE_ADJUSTMENTS[taskType] ?? 0;

  // 5. RPE bonus — 同步版本不查询 DB，默认 0（降级安全）
  const rpe_bonus = 0;

  // Total weight
  const weight = priority_score + wait_bonus + retry_bonus + type_adjustment + rpe_bonus;

  return {
    weight,
    priority_score,
    wait_bonus,
    retry_bonus,
    type_adjustment,
    rpe_bonus,
    breakdown: `priority(${priority_score}) + wait(${wait_bonus}) + retry(${retry_bonus}) + type(${type_adjustment}) + rpe(${rpe_bonus}) = ${weight}`
  };
}

/**
 * 查询某类任务的平均 RPE（最近 RPE_HISTORY_LIMIT 条记录）
 *
 * @param {string} taskType - 任务类型
 * @param {object} db - DB pool（必须提供，便于测试 mock）
 * @returns {Promise<number|null>} 平均 RPE，无数据时返回 null
 */
async function getAvgRPEForTaskType(taskType, db) {
  if (!taskType || !db) return null;
  try {
    const { rows } = await db.query(
      `SELECT AVG((payload->>'rpe')::numeric) AS avg_rpe
       FROM (
         SELECT payload
         FROM cecelia_events
         WHERE event_type = 'rpe_signal'
           AND payload->>'task_type' = $1
         ORDER BY created_at DESC
         LIMIT $2
       ) sub`,
      [taskType, RPE_HISTORY_LIMIT]
    );
    const avg = rows[0]?.avg_rpe;
    if (avg === null || avg === undefined) return null;
    return parseFloat(avg);
  } catch (_e) {
    return null;
  }
}

/**
 * Calculate dispatch weight for a task (async version with RPE signal)
 *
 * RPE > 0（超预期）→ 提升权重
 * RPE < 0（低于预期）→ 降低权重
 * RPE 无数据 → 安全降级，rpe_bonus = 0（与同步版本行为一致）
 *
 * @param {Object} task - Task object from database
 * @param {object} db - DB pool（可选；不提供时等价于同步版本）
 * @returns {Promise<Object>} Weight breakdown with rpe_bonus
 */
async function calculateTaskWeightAsync(task, db) {
  const base = calculateTaskWeight(task);

  if (!db || !task || !task.task_type) {
    return base;
  }

  const taskType = (task.task_type || '').toLowerCase();
  const avgRPE = await getAvgRPEForTaskType(taskType, db);

  if (avgRPE === null) {
    // 无 RPE 数据，安全降级
    return base;
  }

  // 将 avg_rpe 按比例转换为 rpe_bonus，并限制范围
  const rawBonus = avgRPE * RPE_SCALE_FACTOR;
  const rpe_bonus = Math.max(RPE_BONUS_MIN, Math.min(RPE_BONUS_MAX, Math.round(rawBonus)));

  const weight = base.priority_score + base.wait_bonus + base.retry_bonus + base.type_adjustment + rpe_bonus;

  return {
    ...base,
    rpe_bonus,
    weight,
    breakdown: `priority(${base.priority_score}) + wait(${base.wait_bonus}) + retry(${base.retry_bonus}) + type(${base.type_adjustment}) + rpe(${rpe_bonus}) = ${weight}`
  };
}

/**
 * Sort tasks by dispatch weight (highest first)
 *
 * @param {Array} tasks - Array of task objects
 * @returns {Array} Sorted tasks with weight info attached
 */
function sortTasksByWeight(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  return tasks
    .map(task => ({
      ...task,
      _weight: calculateTaskWeight(task)
    }))
    .sort((a, b) => {
      // Higher weight first
      if (b._weight.weight !== a._weight.weight) {
        return b._weight.weight - a._weight.weight;
      }
      // Tiebreaker: earlier queued_at first (FIFO within same weight)
      const aTime = new Date(a.queued_at || a.created_at || 0).getTime();
      const bTime = new Date(b.queued_at || b.created_at || 0).getTime();
      return aTime - bTime;
    });
}

/**
 * Get weight info for multiple tasks (for monitoring/debugging)
 *
 * @param {Array} tasks - Array of task objects
 * @returns {Array} Weight info for each task
 */
function getTaskWeights(tasks) {
  if (!Array.isArray(tasks)) return [];

  return tasks.map(task => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    task_type: task.task_type,
    queued_at: task.queued_at,
    ...calculateTaskWeight(task)
  }));
}

export {
  calculateTaskWeight,
  calculateTaskWeightAsync,
  sortTasksByWeight,
  getTaskWeights,
  getAvgRPEForTaskType,
  PRIORITY_BASE_SCORES,
  TASK_TYPE_ADJUSTMENTS,
  WAIT_BONUS_PER_HOUR,
  WAIT_BONUS_MAX,
  RETRY_BONUS_PER_COUNT,
  RETRY_BONUS_MAX,
  RPE_SCALE_FACTOR,
  RPE_BONUS_MAX,
  RPE_BONUS_MIN
};
