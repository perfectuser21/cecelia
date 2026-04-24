/**
 * Task Weight System - Dynamic Dispatch Priority Calculation
 *
 * Calculates comprehensive dispatch weight for tasks based on:
 * 1. Priority (P0/P1/P2) - base score
 * 2. Wait time (queued_at duration) - urgency bonus
 * 3. Retry count - escalation bonus
 * 4. Task type - type-specific adjustment
 * 5. RPE history (async only) - reward prediction error feedback
 *
 * Higher weight = dispatched first
 */

import pool from './db.js';

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

/**
 * Calculate dispatch weight for a task
 *
 * @param {Object} task - Task object from database
 * @param {string} task.priority - Priority (P0/P1/P2)
 * @param {Date|string|null} task.queued_at - When task was queued
 * @param {number|null} task.retry_count - Number of retries (from payload or metadata)
 * @param {string|null} task.task_type - Task type
 * @returns {Object} Weight breakdown { weight, priority_score, wait_bonus, retry_bonus, type_adjustment, breakdown }
 */
function calculateTaskWeight(task) {
  if (!task || typeof task !== 'object') {
    return { weight: 0, priority_score: 0, wait_bonus: 0, retry_bonus: 0, type_adjustment: 0, breakdown: 'invalid task' };
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
    } catch {
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

  // Total weight
  const weight = priority_score + wait_bonus + retry_bonus + type_adjustment;

  return {
    weight,
    priority_score,
    wait_bonus,
    retry_bonus,
    type_adjustment,
    breakdown: `priority(${priority_score}) + wait(${wait_bonus}) + retry(${retry_bonus}) + type(${type_adjustment}) = ${weight}`
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

// RPE weight feedback constants
const RPE_WEIGHT_SCALE = 4;  // avg_rpe * scale = weight adjustment
const RPE_WEIGHT_CAP = 10;   // max adjustment ±10
const RPE_SAMPLE_SIZE = 20;  // look back at last 20 rpe_signal events

/**
 * Query historical RPE for a task type and compute weight adjustment
 *
 * @param {string} taskType - Task type (e.g. 'dev', 'review')
 * @param {object} [dbPool] - Optional DB pool (for testing)
 * @returns {Promise<number>} Weight adjustment (positive = boost, negative = penalty, 0 = no data)
 */
async function getTaskRPEAdjustment(taskType, dbPool) {
  if (!taskType) return 0;
  const db = dbPool || pool;
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
      [taskType, RPE_SAMPLE_SIZE]
    );
    const avg = rows[0]?.avg_rpe;
    if (avg === null || avg === undefined) return 0;
    const raw = parseFloat(avg) * RPE_WEIGHT_SCALE;
    return Math.max(-RPE_WEIGHT_CAP, Math.min(RPE_WEIGHT_CAP, Math.round(raw * 100) / 100));
  } catch {
    return 0;
  }
}

/**
 * Async version of calculateTaskWeight — includes RPE feedback
 *
 * @param {Object} task - Task object from database
 * @param {object} [dbPool] - Optional DB pool (for testing)
 * @returns {Promise<Object>} Weight breakdown including rpe_bonus
 */
async function calculateTaskWeightAsync(task, dbPool) {
  const base = calculateTaskWeight(task);
  const taskType = (task?.task_type || '').toLowerCase() || null;
  const rpe_bonus = await getTaskRPEAdjustment(taskType, dbPool);
  const weight = base.weight + rpe_bonus;
  return {
    ...base,
    weight,
    rpe_bonus,
    breakdown: `${base.breakdown.replace(/ = \d+(\.\d+)?$/, '')} + rpe(${rpe_bonus}) = ${weight}`
  };
}

export {
  calculateTaskWeight,
  calculateTaskWeightAsync,
  sortTasksByWeight,
  getTaskWeights,
  getTaskRPEAdjustment,
  PRIORITY_BASE_SCORES,
  TASK_TYPE_ADJUSTMENTS,
  WAIT_BONUS_PER_HOUR,
  WAIT_BONUS_MAX,
  RETRY_BONUS_PER_COUNT,
  RETRY_BONUS_MAX,
  RPE_WEIGHT_SCALE,
  RPE_WEIGHT_CAP,
  RPE_SAMPLE_SIZE
};
