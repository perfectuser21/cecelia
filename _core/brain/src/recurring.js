/**
 * Recurring Tasks Engine
 *
 * Checks recurring_tasks table on each tick and creates task instances
 * when their cron schedule matches. Supports cron expressions, daily,
 * weekly, and interval-based recurrence.
 */

import pool from './db.js';

/**
 * Parse a simple cron expression and check if it matches the given date.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 *
 * Examples:
 *   "0 9 * * *"     → every day at 9:00 AM
 *   "0 9 * * 1"     → every Monday at 9:00 AM
 *   "30 14 * * 1-5"  → weekdays at 2:30 PM
 *   "0 * * * *"     → every hour
 *
 * @param {string} cronExpr - Cron expression (5 fields)
 * @param {Date} date - Date to check against
 * @returns {boolean} - Whether the cron matches
 */
export function matchesCron(cronExpr, date) {
  if (!cronExpr || typeof cronExpr !== 'string') return false;

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minuteSpec, hourSpec, domSpec, monthSpec, dowSpec] = parts;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // 1-based
  const dow = date.getDay(); // 0=Sunday

  return (
    matchesField(minuteSpec, minute, 0, 59) &&
    matchesField(hourSpec, hour, 0, 23) &&
    matchesField(domSpec, dom, 1, 31) &&
    matchesField(monthSpec, month, 1, 12) &&
    matchesField(dowSpec, dow, 0, 6)
  );
}

/**
 * Check if a cron field matches a value.
 * Supports: * (wildcard), N (exact), N-M (range), N/S (step), N,M (list)
 */
function matchesField(spec, value, min, max) {
  if (spec === '*') return true;

  // Handle comma-separated list
  const parts = spec.split(',');
  for (const part of parts) {
    // Handle step: */N or N/S
    if (part.includes('/')) {
      const [rangeStr, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;

      let rangeStart = min;
      let rangeEnd = max;
      if (rangeStr !== '*') {
        if (rangeStr.includes('-')) {
          [rangeStart, rangeEnd] = rangeStr.split('-').map(Number);
        } else {
          rangeStart = parseInt(rangeStr, 10);
        }
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) {
        if (i === value) return true;
      }
      continue;
    }

    // Handle range: N-M
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (value >= start && value <= end) return true;
      continue;
    }

    // Handle exact: N
    if (parseInt(part, 10) === value) return true;
  }

  return false;
}

/**
 * Calculate the next run time based on recurrence type.
 *
 * @param {Object} recurringTask - The recurring task record
 * @param {Date} now - Current time
 * @returns {Date|null} - Next run time, or null if cannot calculate
 */
export function calculateNextRunAt(recurringTask, now = new Date()) {
  const { recurrence_type, cron_expression } = recurringTask;

  switch (recurrence_type) {
    case 'daily': {
      // Next day, same time as cron hour/minute (or 9:00 AM default)
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      if (cron_expression) {
        const parts = cron_expression.trim().split(/\s+/);
        if (parts.length >= 2) {
          next.setHours(parseInt(parts[1], 10) || 9, parseInt(parts[0], 10) || 0, 0, 0);
        }
      } else {
        next.setHours(9, 0, 0, 0);
      }
      return next;
    }

    case 'weekly': {
      // Next week, same day-of-week
      const next = new Date(now);
      next.setDate(next.getDate() + 7);
      if (cron_expression) {
        const parts = cron_expression.trim().split(/\s+/);
        if (parts.length >= 2) {
          next.setHours(parseInt(parts[1], 10) || 9, parseInt(parts[0], 10) || 0, 0, 0);
        }
      }
      return next;
    }

    case 'interval': {
      // cron_expression stores interval in minutes for this type
      const intervalMinutes = parseInt(cron_expression, 10);
      if (isNaN(intervalMinutes) || intervalMinutes <= 0) return null;
      return new Date(now.getTime() + intervalMinutes * 60 * 1000);
    }

    case 'cron':
    default: {
      // For cron, approximate: check every minute in the next 7 days
      for (let offset = 1; offset <= 7 * 24 * 60; offset++) {
        const candidate = new Date(now.getTime() + offset * 60 * 1000);
        candidate.setSeconds(0, 0);
        if (matchesCron(cron_expression, candidate)) {
          return candidate;
        }
      }
      return null;
    }
  }
}

/**
 * Check all active recurring tasks and create task instances for those
 * whose schedule matches the current time.
 *
 * Called by tick loop on each tick execution.
 *
 * @param {Date} [now] - Current time (for testing)
 * @returns {Object[]} - Array of created task instances
 */
export async function checkRecurringTasks(now = new Date()) {
  const created = [];

  // Get all active recurring tasks that are due
  const result = await pool.query(`
    SELECT * FROM recurring_tasks
    WHERE is_active = true
      AND (next_run_at IS NULL OR next_run_at <= $1)
    ORDER BY created_at ASC
  `, [now.toISOString()]);

  for (const rt of result.rows) {
    // For cron type, verify the cron expression matches current time
    if (rt.recurrence_type === 'cron' && !matchesCron(rt.cron_expression, now)) {
      continue;
    }

    // Check for dedup: don't create if a task from this recurring template
    // is already queued or in_progress
    const existingResult = await pool.query(`
      SELECT id FROM tasks
      WHERE payload->>'recurring_task_id' = $1
        AND status IN ('queued', 'in_progress')
      LIMIT 1
    `, [rt.id]);

    if (existingResult.rows.length > 0) {
      // Update next_run_at even if we skip (so we don't check again immediately)
      const nextRunAt = calculateNextRunAt(rt, now);
      if (nextRunAt) {
        await pool.query(
          'UPDATE recurring_tasks SET next_run_at = $1, last_run_at = $2 WHERE id = $3',
          [nextRunAt.toISOString(), now.toISOString(), rt.id]
        );
      }
      continue;
    }

    // Create task instance from template
    const template = rt.template || {};
    const taskType = template.task_type || rt.task_type || 'dev';
    const priority = template.priority || rt.priority || 'P1';

    const insertResult = await pool.query(`
      INSERT INTO tasks (
        title, description, status, priority,
        task_type, goal_id, project_id,
        prd_content, payload, trigger_source
      ) VALUES (
        $1, $2, 'queued', $3,
        $4, $5, $6,
        $7, $8, 'recurring'
      ) RETURNING id, title
    `, [
      template.title || rt.title,
      template.description || rt.description || '',
      priority,
      taskType,
      rt.goal_id || template.goal_id || null,
      rt.project_id || template.project_id || null,
      template.prd_content || null,
      JSON.stringify({
        recurring_task_id: rt.id,
        recurring_title: rt.title,
        ...(template.payload || {})
      })
    ]);

    const createdTask = insertResult.rows[0];
    console.log(`[recurring] Created task instance: ${createdTask.title} (id=${createdTask.id}) from recurring=${rt.id}`);

    // Update recurring task with last_run_at and next_run_at
    const nextRunAt = calculateNextRunAt(rt, now);
    await pool.query(
      'UPDATE recurring_tasks SET last_run_at = $1, next_run_at = $2 WHERE id = $3',
      [now.toISOString(), nextRunAt ? nextRunAt.toISOString() : null, rt.id]
    );

    created.push({
      task_id: createdTask.id,
      task_title: createdTask.title,
      recurring_task_id: rt.id,
      recurring_title: rt.title,
      next_run_at: nextRunAt ? nextRunAt.toISOString() : null
    });
  }

  return created;
}
