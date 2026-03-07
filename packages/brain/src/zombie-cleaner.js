/**
 * Zombie Cleaner — 资源免疫系统 Phase 1
 *
 * 两套清理职责：
 *
 * === A. Tick 集成 API（供 tick.js 5c-2 阶段调用）===
 *   cleanZombieSlots(staleSlots) — 消费 watchdog.resolveTaskPids() 返回的 staleSlots
 *     → emergencyCleanup + 标记 DB task failed(zombie_process_gone) + emit event
 *   detectOrphanTasks(pidMap) — 检测 in_progress > 4h 且无进程的任务 → failed(orphan_no_process)
 *   getZombieStats() — 返回 24h 内清理统计（last_cleanup_at/zombies_cleaned_24h/orphans_fixed_24h）
 *
 * === B. 定时清理入口（供 tick.js nightly 阶段调用）===
 *   cleanupStaleSlots() — 文件级清理：rmSync stale lock slot dir（pid 死亡 >60s）
 *   cleanupOrphanWorktrees(pool) — 清理无活跃任务的孤儿 worktree（>30min）
 *   runZombieCleanup(pool) — R1 + R2 统一入口
 *
 * 设计原则：
 * - 每步独立 try/catch，单步失败不影响其他步骤
 * - 只清理已确认死亡的资源，不干扰正在运行的任务
 * - 所有操作有日志记录，可审计
 */

import { existsSync, readFileSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import pool from './db.js';
import { emit } from './event-bus.js';
import { resolveTaskPids } from './watchdog.js';
import { removeActiveProcess } from './executor.js';

const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';
const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
const REPO_ROOT = process.env.REPO_ROOT || '/Users/administrator/perfect21/cecelia';

// ─── A. Tick 集成 API ────────────────────────────────────────────────────────

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
 *   - in_progress > ORPHAN_WARN_HOURS (8h) AND has process → warn only
 *
 * @param {Map<string, {pid, pgid, started, slot}>} pidMap
 * @returns {Promise<{orphans_fixed: number, warnings: number, errors: number}>}
 */
export async function detectOrphanTasks(pidMap) {
  const stats = { orphans_fixed: 0, warnings: 0, errors: 0 };

  try {
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

  const lastEvent = _cleanHistory.length > 0
    ? _cleanHistory[_cleanHistory.length - 1].ts
    : null;

  return {
    last_cleanup_at: lastEvent ? new Date(lastEvent).toISOString() : null,
    zombies_cleaned_24h: zombies,
    orphans_fixed_24h: orphans,
  };
}

// ─── B. 定时清理入口 ─────────────────────────────────────────────────────────

const STALE_SLOT_MIN_AGE_MS = 60 * 1000;           // slot 至少死亡 60 秒才清理
const ORPHAN_WORKTREE_MIN_AGE_MS = 30 * 60 * 1000; // worktree 至少孤儿 30 分钟才清理

/**
 * R1: 清理 stale slot 目录（pid 已死超过 60 秒）
 * 文件级清理，不更新 DB（由 cleanZombieSlots 负责 DB 部分）
 *
 * @returns {{ reclaimed: number, errors: string[] }}
 */
export function cleanupStaleSlots() {
  const result = { reclaimed: 0, errors: [] };

  let staleSlots;
  try {
    ({ staleSlots } = resolveTaskPids());
  } catch (err) {
    result.errors.push(`resolveTaskPids: ${err.message}`);
    return result;
  }

  if (!staleSlots || staleSlots.length === 0) return result;

  if (!staleSlots || staleSlots.length === 0) return result;

  const now = Date.now();

  for (const { slot, taskId } of staleSlots) {
    const slotDir = join(LOCK_DIR, slot);

    try {
      if (!existsSync(slotDir)) {
        removeActiveProcess(taskId);
        continue;
      }

      let mtime;
      try {
        mtime = statSync(slotDir).mtimeMs;
      } catch (e) {
        result.errors.push(`stat(${slot}): ${e.message}`);
        continue;
      }

      const ageMs = now - mtime;
      if (ageMs < STALE_SLOT_MIN_AGE_MS) {
        console.log(`[zombie-cleaner] Slot ${slot} (task=${taskId}) pid dead but age=${Math.round(ageMs / 1000)}s < 60s, skipping`);
        continue;
      }

      console.log(`[zombie-cleaner] Reclaiming stale slot: dir=${slotDir} task=${taskId} age=${Math.round(ageMs / 1000)}s`);
      rmSync(slotDir, { recursive: true, force: true });
      removeActiveProcess(taskId);
      result.reclaimed++;
      console.log(`[zombie-cleaner] Stale slot reclaimed: ${slot} (task=${taskId})`);
    } catch (err) {
      result.errors.push(`slot(${slot}): ${err.message}`);
    }
  }

  if (result.errors.length > 0) {
    console.warn(`[zombie-cleaner] cleanupStaleSlots completed with errors:`, result.errors);
  }

  return result;
}

/**
 * 从 worktree 目录中提取关联的 task_id。
 */
export function findTaskIdForWorktree(wtPath) {
  try {
    const devModePath = join(wtPath, '.dev-mode');
    if (existsSync(devModePath)) {
      const content = readFileSync(devModePath, 'utf-8');
      const taskMatch = content.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
      if (taskMatch) return taskMatch[1];
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * R2: 清理孤儿 git worktree（无活跃任务对应且存在 >30min）
 *
 * @param {import('pg').Pool} dbPool - PostgreSQL 连接池
 * @returns {Promise<{ removed: number, errors: string[] }>}
 */
export async function cleanupOrphanWorktrees(dbPool) {
  const result = { removed: 0, errors: [] };

  let worktreePaths;
  try {
    const raw = execSync('git worktree list --porcelain', {
      cwd: REPO_ROOT,
      timeout: 10000,
      encoding: 'utf-8',
    });
    worktreePaths = raw
      .split('\n\n')
      .map(block => {
        const match = block.match(/^worktree (.+)/m);
        return match ? match[1].trim() : null;
      })
      .filter(Boolean);
  } catch (err) {
    result.errors.push(`git worktree list: ${err.message}`);
    return result;
  }

  const managedWorktrees = worktreePaths.filter(p => p.startsWith(WORKTREE_BASE));
  if (managedWorktrees.length === 0) return result;

  let activeTasks = new Set();
  try {
    const queryResult = await dbPool.query(
      "SELECT id FROM tasks WHERE status = 'in_progress'"
    );
    for (const row of queryResult.rows) {
      activeTasks.add(row.id);
    }
  } catch (err) {
    result.errors.push(`db query: ${err.message}`);
    return result;
  }

  const now = Date.now();

  for (const wtPath of managedWorktrees) {
    try {
      if (!existsSync(wtPath)) continue;

      let mtime;
      try {
        mtime = statSync(wtPath).mtimeMs;
      } catch (e) {
        result.errors.push(`stat(${wtPath}): ${e.message}`);
        continue;
      }

      const ageMs = now - mtime;
      if (ageMs < ORPHAN_WORKTREE_MIN_AGE_MS) continue;

      const taskId = findTaskIdForWorktree(wtPath);
      if (taskId && activeTasks.has(taskId)) continue;

      const ageMin = Math.round(ageMs / 60000);
      console.log(`[zombie-cleaner] Orphan worktree: ${wtPath} age=${ageMin}min taskId=${taskId || 'unknown'}`);

      try {
        execSync(`git worktree remove --force "${wtPath}"`, {
          cwd: REPO_ROOT,
          timeout: 15000,
          stdio: 'pipe',
        });
        result.removed++;
        console.log(`[zombie-cleaner] Orphan worktree removed: ${wtPath}`);
      } catch (removeErr) {
        try {
          rmSync(wtPath, { recursive: true, force: true });
          execSync('git worktree prune', { cwd: REPO_ROOT, timeout: 5000, stdio: 'pipe' });
          result.removed++;
          console.log(`[zombie-cleaner] Orphan worktree removed (fallback): ${wtPath}`);
        } catch (fallbackErr) {
          result.errors.push(`remove(${wtPath}): ${fallbackErr.message}`);
        }
      }
    } catch (err) {
      result.errors.push(`worktree(${wtPath}): ${err.message}`);
    }
  }

  if (result.errors.length > 0) {
    console.warn(`[zombie-cleaner] cleanupOrphanWorktrees completed with errors:`, result.errors);
  }

  return result;
}

/**
 * 统一清理入口 (R1 + R2)
 *
 * @param {import('pg').Pool} dbPool - PostgreSQL 连接池
 * @returns {Promise<{ slotsReclaimed: number, worktreesRemoved: number, timestamp: string, errors: string[] }>}
 */
export async function runZombieCleanup(dbPool) {
  const startTs = Date.now();
  console.log('[zombie-cleaner] Starting zombie resource cleanup...');

  const report = {
    slotsReclaimed: 0,
    worktreesRemoved: 0,
    timestamp: new Date(startTs).toISOString(),
    errors: [],
  };

  try {
    const slotResult = cleanupStaleSlots();
    report.slotsReclaimed = slotResult.reclaimed;
    report.errors.push(...slotResult.errors);
  } catch (err) {
    report.errors.push(`stale-slots: ${err.message}`);
  }

  try {
    const wtResult = await cleanupOrphanWorktrees(dbPool);
    report.worktreesRemoved = wtResult.removed;
    report.errors.push(...wtResult.errors);
  } catch (err) {
    report.errors.push(`orphan-worktrees: ${err.message}`);
  }

  const durationMs = Date.now() - startTs;
  console.log(
    `[zombie-cleaner] Cleanup done in ${durationMs}ms: ` +
    `slots=${report.slotsReclaimed} worktrees=${report.worktreesRemoved} errors=${report.errors.length}`
  );

  return report;
}

// Export for testing
export { _cleanHistory, ORPHAN_THRESHOLD_HOURS, ORPHAN_WARN_HOURS, STALE_SLOT_MIN_AGE_MS, ORPHAN_WORKTREE_MIN_AGE_MS };
