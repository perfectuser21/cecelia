/**
 * Zombie Cleaner — 资源免疫系统 Phase 1
 *
 * 职责：
 * 1. cleanZombieSlots(staleSlots) — 清理僵尸 slot（进程已消失但 lock 目录仍在）
 *    - 调用 emergencyCleanup() 清理 worktree + lock dir
 *    - 将 DB 中对应任务标记为 failed（reason: zombie_process_gone）
 *    - 写入 event-bus 事件 zombie_cleaned
 *
 * 2. detectOrphanTasks(pidMap) — 检测孤儿 in_progress 任务
 *    - DB 中 in_progress > 4h 且无活跃进程 → 标记 failed（reason: orphan_no_process）
 *    - in_progress > 8h 且有进程 → warn 日志
 *
 * 3. getZombieStats() — 返回 24h 内清理统计（供 immune/dashboard API 使用）
 *
 * 设计原则：
 * - 每步独立 try/catch，一步失败不影响其他
 * - 统计基于时间窗口（24h），用内存数组记录事件时间戳
 * - 不依赖外部状态机，可随时重启
 */

import pool from './db.js';
import { emit } from './event-bus.js';

const ORPHAN_THRESHOLD_HOURS = parseInt(process.env.ORPHAN_THRESHOLD_HOURS || '4', 10);
const ORPHAN_WARN_HOURS = parseInt(process.env.ORPHAN_WARN_HOURS || '8', 10);
const STATS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory event history for 24h stats
// Each entry: { type: 'zombie'|'orphan', ts: Date.now() }
const _cleanHistory = [];

function _recordCleanEvent(type) {
  _cleanHistory.push({ type, ts: Date.now() });
  // Prune entries older than 24h
  const cutoff = Date.now() - STATS_WINDOW_MS;
  while (_cleanHistory.length > 0 && _cleanHistory[0].ts < cutoff) {
    _cleanHistory.shift();
  }
}

/**
 * Clean up zombie slots: process is gone but lock dir still exists.
 *
 * For each stale slot:
 *   1. Call emergencyCleanup() → cleans worktree + lock dir
 *   2. Mark DB task as failed (reason: zombie_process_gone)
 *   3. Emit event-bus event zombie_cleaned
 *
 * @param {Array<{slot: string, taskId: string}>} staleSlots
 * @returns {Promise<Array<{taskId, slot, cleaned, dbUpdated, errors}>>}
 */
export async function cleanZombieSlots(staleSlots) {
  if (!staleSlots || staleSlots.length === 0) return [];

  const results = [];

  for (const { slot, taskId } of staleSlots) {
    const entry = { taskId, slot, cleaned: false, dbUpdated: false, errors: [] };

    // Step 1: emergency cleanup (worktree + lock dir)
    try {
      const { emergencyCleanup } = await import('./emergency-cleanup.js');
      const cleanResult = emergencyCleanup(taskId, slot);
      entry.cleaned = cleanResult.worktree || cleanResult.lock;
      if (cleanResult.errors.length > 0) {
        entry.errors.push(...cleanResult.errors.map(e => `cleanup: ${e}`));
      }
      console.log(`[zombie-cleaner] slot=${slot} task=${taskId} cleaned: wt=${cleanResult.worktree} lock=${cleanResult.lock}`);
    } catch (err) {
      console.warn(`[zombie-cleaner] emergencyCleanup failed for task=${taskId} slot=${slot}:`, err.message);
      entry.errors.push(`emergencyCleanup: ${err.message}`);
    }

    // Step 2: mark DB task as failed
    try {
      const result = await pool.query(`
        UPDATE tasks
        SET status = 'failed',
            error = $2,
            updated_at = NOW()
        WHERE id = $1
          AND status IN ('queued', 'in_progress', 'dispatched')
        RETURNING id
      `, [taskId, 'zombie_process_gone']);

      entry.dbUpdated = result.rowCount > 0;
      if (entry.dbUpdated) {
        console.log(`[zombie-cleaner] task=${taskId} marked failed (zombie_process_gone)`);
      }
    } catch (dbErr) {
      console.error(`[zombie-cleaner] DB update failed for task=${taskId}:`, dbErr.message);
      entry.errors.push(`db: ${dbErr.message}`);
    }

    // Step 3: emit event-bus event
    try {
      await emit('zombie_cleaned', 'zombie-cleaner', {
        task_id: taskId,
        slot,
        cleaned: entry.cleaned,
        db_updated: entry.dbUpdated,
      });
    } catch (emitErr) {
      // Non-fatal
      entry.errors.push(`emit: ${emitErr.message}`);
    }

    if (entry.cleaned || entry.dbUpdated) {
      _recordCleanEvent('zombie');
    }

    results.push(entry);
  }

  return results;
}

/**
 * Detect orphan in_progress tasks (no corresponding live process).
 *
 * Rules:
 *   - in_progress > ORPHAN_THRESHOLD_HOURS (4h) AND no active process → mark failed
 *   - in_progress > ORPHAN_WARN_HOURS (8h) AND has process → warn only (watchdog handles kill)
 *
 * @param {Map<string, {pid, pgid, started, slot}>} pidMap - Active slot/process map from resolveTaskPids()
 * @returns {Promise<{orphans_fixed: number, warnings: number, errors: number}>}
 */
export async function detectOrphanTasks(pidMap) {
  const stats = { orphans_fixed: 0, warnings: 0, errors: 0 };

  try {
    // Query in_progress tasks older than ORPHAN_THRESHOLD_HOURS
    const result = await pool.query(`
      SELECT id, title, started_at
      FROM tasks
      WHERE status = 'in_progress'
        AND started_at < NOW() - INTERVAL '${ORPHAN_THRESHOLD_HOURS} hours'
      ORDER BY started_at ASC
    `);

    if (result.rows.length === 0) return stats;

    const now = Date.now();

    for (const task of result.rows) {
      const hoursElapsed = (now - new Date(task.started_at).getTime()) / (1000 * 60 * 60);
      const hasProcess = pidMap && pidMap.has(task.id);

      if (!hasProcess) {
        // Orphan: no live process, mark as failed
        try {
          const updateResult = await pool.query(`
            UPDATE tasks
            SET status = 'failed',
                error = $2,
                updated_at = NOW()
            WHERE id = $1
              AND status = 'in_progress'
            RETURNING id
          `, [task.id, 'orphan_no_process']);

          if (updateResult.rowCount > 0) {
            console.log(`[zombie-cleaner] orphan task=${task.id} "${task.title}" (${hoursElapsed.toFixed(1)}h) marked failed`);
            _recordCleanEvent('orphan');
            stats.orphans_fixed++;

            // Emit event
            try {
              await emit('orphan_detected', 'zombie-cleaner', {
                task_id: task.id,
                title: task.title,
                hours_elapsed: Math.round(hoursElapsed * 10) / 10,
                reason: 'orphan_no_process',
              });
            } catch { /* non-fatal */ }
          }
        } catch (dbErr) {
          console.error(`[zombie-cleaner] Failed to mark orphan task=${task.id} as failed:`, dbErr.message);
          stats.errors++;
        }
      } else if (hoursElapsed > ORPHAN_WARN_HOURS) {
        // Has process but running very long — warn only, watchdog handles kill
        console.warn(`[zombie-cleaner] WARN: task=${task.id} "${task.title}" in_progress for ${hoursElapsed.toFixed(1)}h (has process, watchdog will handle)`);
        stats.warnings++;
      }
    }
  } catch (err) {
    console.error('[zombie-cleaner] detectOrphanTasks error:', err.message);
    stats.errors++;
  }

  return stats;
}

/**
 * Get zombie cleanup statistics for the last 24 hours.
 *
 * @returns {{ last_cleanup_at: string|null, zombies_cleaned_24h: number, orphans_fixed_24h: number }}
 */
export function getZombieStats() {
  const cutoff = Date.now() - STATS_WINDOW_MS;

  // Prune stale entries
  while (_cleanHistory.length > 0 && _cleanHistory[0].ts < cutoff) {
    _cleanHistory.shift();
  }

  const zombies = _cleanHistory.filter(e => e.type === 'zombie').length;
  const orphans = _cleanHistory.filter(e => e.type === 'orphan').length;

  // last_cleanup_at: most recent event timestamp
  const lastEvent = _cleanHistory.length > 0
    ? _cleanHistory[_cleanHistory.length - 1].ts
    : null;

  return {
    last_cleanup_at: lastEvent ? new Date(lastEvent).toISOString() : null,
    zombies_cleaned_24h: zombies,
    orphans_fixed_24h: orphans,
  };
}

// Export for testing
export { _cleanHistory, ORPHAN_THRESHOLD_HOURS, ORPHAN_WARN_HOURS };
