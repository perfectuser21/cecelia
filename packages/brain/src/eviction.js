/**
 * Eviction Engine - 优先级驱逐引擎
 *
 * 当高优先级任务需要 slot 但 Pool C 已满时，
 * 主动驱逐低优先级任务释放资源。
 *
 * 驱逐层级：
 *   P0/P1 = 永不驱逐
 *   P2 = 可驱逐（5 分钟退避后 requeue）
 *   P3 = 最先驱逐（无退避 requeue）
 *
 * 驱逐分数：
 *   eviction_score = tier_weight + memory% - runtime_penalty
 *   分数越高越先被驱逐
 */

import { resolveTaskPids, sampleProcess } from './watchdog.js';
import pool from './db.js';
import os from 'os';

// Eviction tier weights
const TIER_WEIGHTS = {
  P0: -Infinity,  // never evict
  P1: -Infinity,  // never evict
  P2: 50,         // evictable
  P3: 100,        // evict first
};

// Requeue backoff per tier (ms)
const REQUEUE_BACKOFF = {
  P2: 5 * 60 * 1000,  // 5 minutes
  P3: 0,               // immediate
};

// Runtime penalty: tasks running longer get slight protection (per hour)
const RUNTIME_PENALTY_PER_HOUR = 10;

const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);

/**
 * Calculate eviction score for a task.
 * Higher score = evict first. -Infinity = never evict.
 *
 * @param {string} priority - Task priority (P0/P1/P2/P3)
 * @param {number} rssMb - Current RSS in MB
 * @param {number} runtimeMs - How long the task has been running
 * @returns {number} Eviction score
 */
function calcEvictionScore(priority, rssMb, runtimeMs) {
  const tierWeight = TIER_WEIGHTS[priority] ?? TIER_WEIGHTS.P3;
  if (tierWeight === -Infinity) return -Infinity;

  const memPct = (rssMb / TOTAL_MEM_MB) * 100;
  const runtimeHours = runtimeMs / (1000 * 60 * 60);
  const runtimePenalty = runtimeHours * RUNTIME_PENALTY_PER_HOUR;

  return tierWeight + memPct - runtimePenalty;
}

/**
 * Find the best candidate to evict to make room for a higher-priority task.
 *
 * @param {string} incomingPriority - Priority of the task that needs a slot
 * @returns {Promise<{ taskId: string, pid: number, pgid: number, priority: string, score: number, slot: string } | null>}
 */
async function findEvictionCandidate(incomingPriority) {
  // Only P0/P1 tasks can trigger eviction
  if (incomingPriority !== 'P0' && incomingPriority !== 'P1') return null;

  const { pidMap } = resolveTaskPids();
  if (pidMap.size === 0) return null;

  // Get all in-progress task priorities from DB
  const taskIds = Array.from(pidMap.keys());
  const result = await pool.query(
    'SELECT id, priority FROM tasks WHERE id = ANY($1) AND status = $2',
    [taskIds, 'in_progress']
  );

  const taskPriorityMap = new Map(result.rows.map(r => [r.id, r.priority]));

  const candidates = [];
  for (const [taskId, { pid, pgid, started, slot }] of pidMap) {
    const priority = taskPriorityMap.get(taskId);
    if (!priority) continue;

    const sample = sampleProcess(pid);
    if (!sample) continue;

    const runtimeMs = started ? Date.now() - new Date(started).getTime() : 0;
    const score = calcEvictionScore(priority, sample.rss_mb, runtimeMs);

    if (score === -Infinity) continue; // P0/P1 never evict

    candidates.push({ taskId, pid, pgid, priority, score, slot, rss_mb: sample.rss_mb });
  }

  if (candidates.length === 0) return null;

  // Sort by score descending, evict the highest score
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/**
 * Requeue an evicted task with tier-appropriate backoff.
 *
 * @param {string} taskId - Task to requeue
 * @param {string} priority - Task priority (determines backoff)
 * @param {string} reason - Eviction reason
 * @returns {Promise<{ requeued: boolean, next_run_at: string | null }>}
 */
async function requeueEvictedTask(taskId, priority, reason) {
  const backoffMs = REQUEUE_BACKOFF[priority] ?? 0;
  const nextRunAt = backoffMs > 0
    ? new Date(Date.now() + backoffMs).toISOString()
    : null;

  const payload = {
    evicted: true,
    eviction_reason: reason,
    evicted_at: new Date().toISOString(),
  };
  if (nextRunAt) {
    payload.next_run_at = nextRunAt;
  }

  const result = await pool.query(
    `UPDATE tasks SET status = 'queued', started_at = NULL,
     payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
     WHERE id = $1 AND status = 'in_progress'`,
    [taskId, JSON.stringify(payload)]
  );

  return {
    requeued: result.rowCount > 0,
    next_run_at: nextRunAt,
  };
}

export {
  calcEvictionScore,
  findEvictionCandidate,
  requeueEvictedTask,
  TIER_WEIGHTS,
  REQUEUE_BACKOFF,
};
