/**
 * Task Cleanup - Automatic maintenance for stale/blocked tasks
 *
 * Implements:
 * 1. Cancel recurring tasks that have been queued too long (>24h)
 * 2. Archive paused tasks older than 30 days
 *
 * Design philosophy:
 * - Be conservative: only cancel tasks that are clearly stuck
 * - Log all actions for auditability
 * - Return stats for monitoring
 */

// Thresholds
const RECURRING_QUEUE_TIMEOUT_HOURS = 24;    // Cancel recurring tasks queued for >24h
const PAUSED_ARCHIVE_DAYS = 30;              // Archive paused tasks older than 30 days

// In-memory audit log (最多保留 500 条，防止内存泄漏)
const MAX_AUDIT_LOG_SIZE = 500;
const _auditLog = [];

// Recurring task types (these should be re-generated periodically, not queued forever)
const RECURRING_TASK_TYPES = [
  'dept_heartbeat',
  'codex_qa'
];

// Protected task types (should NEVER be auto-canceled by cleanup)
// These task types are critical for system operation and must be manually managed
const PROTECTED_TASK_TYPES = [
  'initiative_plan',   // Initiative planning tasks - must not be auto-canceled
  'initiative_verify'  // Initiative verification tasks - must not be auto-canceled
];

// Recurring task title patterns (fallback detection when task_type not set)
const RECURRING_TITLE_PATTERNS = [
  /heartbeat/i,
  /weekly check/i,
  /daily briefing/i,
  /periodic/i
];

/**
 * Check if a task is protected from automatic cleanup
 * Protected tasks should never be auto-canceled, even if they've been queued for a long time.
 * @param {Object} task - Task object with task_type field
 * @returns {boolean}
 */
function isProtectedTask(task) {
  if (!task) return false;

  if (task.task_type && PROTECTED_TASK_TYPES.includes(task.task_type.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * Check if a task is considered "recurring" based on task_type or title
 * @param {Object} task - Task object with task_type and title fields
 * @returns {boolean}
 */
function isRecurringTask(task) {
  if (!task) return false;

  // Protected tasks are never considered "recurring" for cleanup purposes
  if (isProtectedTask(task)) {
    return false;
  }

  // Check by task_type
  if (task.task_type && RECURRING_TASK_TYPES.includes(task.task_type.toLowerCase())) {
    return true;
  }

  // Check by payload flag
  if (task.payload && task.payload.is_recurring === true) {
    return true;
  }

  // Check by title pattern
  const title = task.title || '';
  for (const pattern of RECURRING_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return true;
    }
  }

  return false;
}

/**
 * Run task cleanup: cancel stale recurring tasks and archive old paused tasks
 *
 * @param {Object} db - pg Pool instance
 * @param {Object} options - Options
 * @param {number} [options.recurringTimeoutHours] - Override recurring timeout (default: 24)
 * @param {number} [options.pausedArchiveDays] - Override paused archive threshold (default: 30)
 * @param {boolean} [options.dryRun] - If true, don't actually update, just return what would change
 * @returns {Promise<Object>} Stats { canceled, archived, dry_run }
 */
async function runTaskCleanup(db, options = {}) {
  const {
    recurringTimeoutHours = RECURRING_QUEUE_TIMEOUT_HOURS,
    pausedArchiveDays = PAUSED_ARCHIVE_DAYS,
    dryRun = false
  } = options;

  const stats = {
    canceled: 0,
    archived: 0,
    dry_run: dryRun,
    canceled_task_ids: [],
    archived_task_ids: [],
    errors: []
  };

  try {
    // === Step 1: Cancel stale recurring tasks ===
    const staleRecurringCutoff = new Date(Date.now() - recurringTimeoutHours * 60 * 60 * 1000);

    const staleRecurringResult = await db.query(`
      SELECT id, title, task_type, queued_at, payload
      FROM tasks
      WHERE status = 'queued'
        AND queued_at < $1
        AND (
          task_type = ANY($2::text[])
          OR (payload->>'is_recurring')::boolean = true
        )
        AND (task_type IS NULL OR task_type != ALL($3::text[]))
    `, [
      staleRecurringCutoff.toISOString(),
      RECURRING_TASK_TYPES,
      PROTECTED_TASK_TYPES
    ]);

    const recurringTasks = staleRecurringResult.rows;

    if (recurringTasks.length > 0) {
      console.log(`[task-cleanup] Found ${recurringTasks.length} stale recurring tasks (queued >${recurringTimeoutHours}h)`);

      if (!dryRun) {
        const idsToCancel = recurringTasks.map(t => t.id);
        await db.query(`
          UPDATE tasks
          SET
            status = 'canceled',
            updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = ANY($1::uuid[])
        `, [
          idsToCancel,
          JSON.stringify({
            cleanup_reason: 'stale_recurring',
            cleanup_at: new Date().toISOString(),
            original_queued_at: null  // Will be overridden per-task if needed
          })
        ]);

        stats.canceled = idsToCancel.length;
        stats.canceled_task_ids = idsToCancel;

        for (const task of recurringTasks) {
          console.log(`[task-cleanup] Canceled recurring task: ${task.title} (id=${task.id}, queued_at=${task.queued_at})`);
          // 写入审计日志
          _appendAuditLog({
            action: 'canceled',
            task_id: task.id,
            task_title: task.title,
            task_type: task.task_type || null,
            reason: 'stale_recurring',
            detail: `queued_at=${task.queued_at}, threshold=${recurringTimeoutHours}h`,
            dry_run: false,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        stats.canceled = recurringTasks.length;
        stats.canceled_task_ids = recurringTasks.map(t => t.id);
        console.log(`[task-cleanup] [DRY RUN] Would cancel ${recurringTasks.length} recurring tasks`);
        // 写入 dry_run 审计日志
        for (const task of recurringTasks) {
          _appendAuditLog({
            action: 'canceled',
            task_id: task.id,
            task_title: task.title,
            task_type: task.task_type || null,
            reason: 'stale_recurring',
            detail: `queued_at=${task.queued_at}, threshold=${recurringTimeoutHours}h`,
            dry_run: true,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // === Step 2: Archive old paused tasks ===
    const pausedArchiveCutoff = new Date(Date.now() - pausedArchiveDays * 24 * 60 * 60 * 1000);

    const stalePausedResult = await db.query(`
      SELECT id, title, task_type, updated_at
      FROM tasks
      WHERE status = 'paused'
        AND updated_at < $1
    `, [pausedArchiveCutoff.toISOString()]);

    const pausedTasks = stalePausedResult.rows;

    if (pausedTasks.length > 0) {
      console.log(`[task-cleanup] Found ${pausedTasks.length} old paused tasks (paused >${pausedArchiveDays} days)`);

      if (!dryRun) {
        const idsToArchive = pausedTasks.map(t => t.id);
        await db.query(`
          UPDATE tasks
          SET
            status = 'archived',
            updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
          WHERE id = ANY($1::uuid[])
        `, [
          idsToArchive,
          JSON.stringify({
            cleanup_reason: 'stale_paused',
            cleanup_at: new Date().toISOString()
          })
        ]);

        stats.archived = idsToArchive.length;
        stats.archived_task_ids = idsToArchive;

        for (const task of pausedTasks) {
          console.log(`[task-cleanup] Archived paused task: ${task.title} (id=${task.id}, updated_at=${task.updated_at})`);
          // 写入审计日志
          _appendAuditLog({
            action: 'archived',
            task_id: task.id,
            task_title: task.title,
            task_type: task.task_type || null,
            reason: 'stale_paused',
            detail: `updated_at=${task.updated_at}, threshold=${pausedArchiveDays}d`,
            dry_run: false,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        stats.archived = pausedTasks.length;
        stats.archived_task_ids = pausedTasks.map(t => t.id);
        console.log(`[task-cleanup] [DRY RUN] Would archive ${pausedTasks.length} paused tasks`);
        // 写入 dry_run 审计日志
        for (const task of pausedTasks) {
          _appendAuditLog({
            action: 'archived',
            task_id: task.id,
            task_title: task.title,
            task_type: task.task_type || null,
            reason: 'stale_paused',
            detail: `updated_at=${task.updated_at}, threshold=${pausedArchiveDays}d`,
            dry_run: true,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    if (stats.canceled === 0 && stats.archived === 0) {
      console.log('[task-cleanup] No stale tasks found, nothing to clean up');
    } else {
      console.log(`[task-cleanup] Cleanup complete: canceled=${stats.canceled}, archived=${stats.archived}`);
    }

  } catch (err) {
    console.error('[task-cleanup] Error during cleanup:', err.message);
    stats.errors.push(err.message);
  }

  return stats;
}

/**
 * Get cleanup/dispatch statistics for monitoring
 * (Distinct from dispatch-stats.js which tracks success rates)
 *
 * @param {Object} db - pg Pool instance
 * @returns {Promise<Object>} Stats object
 */
async function getCleanupStats(db) {
  try {
    // Tasks canceled in the last 24 hours
    const canceledResult = await db.query(`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE status IN ('canceled', 'cancelled')
        AND updated_at >= NOW() - INTERVAL '24 hours'
    `);

    // Tasks queued by priority
    const queuedByPriorityResult = await db.query(`
      SELECT priority, COUNT(*) as count,
             MIN(queued_at) as oldest_queued_at
      FROM tasks
      WHERE status = 'queued'
      GROUP BY priority
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
    `);

    // Average wait time for queued tasks by priority
    const avgWaitResult = await db.query(`
      SELECT priority,
             ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - queued_at)) / 60)::numeric, 1) as avg_wait_minutes
      FROM tasks
      WHERE status = 'queued'
        AND queued_at IS NOT NULL
      GROUP BY priority
    `);

    // Stale recurring tasks (would be cleaned up)
    const staleRecurringResult = await db.query(`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE status = 'queued'
        AND queued_at < NOW() - INTERVAL '24 hours'
        AND (
          task_type = ANY($1::text[])
          OR (payload->>'is_recurring')::boolean = true
        )
    `, [RECURRING_TASK_TYPES]);

    // Old paused tasks (would be archived)
    const stalePausedResult = await db.query(`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE status = 'paused'
        AND updated_at < NOW() - INTERVAL '30 days'
    `);

    const avgWaitByPriority = {};
    for (const row of avgWaitResult.rows) {
      avgWaitByPriority[row.priority] = parseFloat(row.avg_wait_minutes) || 0;
    }

    const queuedByPriority = {};
    let oldestQueuedAt = null;
    for (const row of queuedByPriorityResult.rows) {
      queuedByPriority[row.priority] = parseInt(row.count);
      if (row.oldest_queued_at && (!oldestQueuedAt || row.oldest_queued_at < oldestQueuedAt)) {
        oldestQueuedAt = row.oldest_queued_at;
      }
    }

    return {
      canceled_last_24h: parseInt(canceledResult.rows[0].count),
      queued_by_priority: queuedByPriority,
      avg_wait_minutes_by_priority: avgWaitByPriority,
      stale_recurring_tasks: parseInt(staleRecurringResult.rows[0].count),
      old_paused_tasks: parseInt(stalePausedResult.rows[0].count),
      oldest_queued_at: oldestQueuedAt,
      generated_at: new Date().toISOString()
    };
  } catch (err) {
    console.error('[task-cleanup] Error getting dispatch stats:', err.message);
    throw err;
  }
}

/**
 * 内部函数：向审计日志追加记录（自动 trim 超出限制的旧记录）
 * @param {Object} entry - 审计记录
 */
function _appendAuditLog(entry) {
  _auditLog.push(entry);
  // 保持最多 MAX_AUDIT_LOG_SIZE 条记录（删除最旧的）
  if (_auditLog.length > MAX_AUDIT_LOG_SIZE) {
    _auditLog.splice(0, _auditLog.length - MAX_AUDIT_LOG_SIZE);
  }
}

/**
 * 获取清理审计日志
 * @param {number} [limit=100] - 返回最近 N 条记录
 * @returns {Object[]} 审计日志数组（从新到旧）
 */
function getCleanupAuditLog(limit = 100) {
  const safeLimit = Math.min(Math.max(1, parseInt(limit) || 100), MAX_AUDIT_LOG_SIZE);
  // 返回最新的 N 条（倒序）
  return _auditLog.slice(-safeLimit).reverse();
}

export {
  runTaskCleanup,
  getCleanupStats,
  getCleanupAuditLog,
  isRecurringTask,
  isProtectedTask,
  RECURRING_TASK_TYPES,
  PROTECTED_TASK_TYPES,
  RECURRING_TITLE_PATTERNS,
  RECURRING_QUEUE_TIMEOUT_HOURS,
  PAUSED_ARCHIVE_DAYS
};
