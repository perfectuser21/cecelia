/**
 * Self-Diagnosis - Cecelia reads her own EventLog and generates improvement tasks
 *
 * Analyzes: success rate, failure rate, avg duration, unstable workers,
 * slowest KRs, and generates actionable improvement tasks.
 */

import pool from '../task-system/db.js';
import { queryEvents, getEventCounts } from './event-bus.js';
import { getAllStates } from './circuit-breaker.js';
import { notifyDailySummary } from './notifier.js';

/**
 * Run self-diagnosis on recent events
 * @param {Object} [options]
 * @param {string} [options.since] - ISO timestamp (default: last 7 days)
 * @param {boolean} [options.createTasks] - Whether to write improvement tasks to DB (default: false)
 * @param {string} [options.projectId] - Project ID for created tasks
 * @param {string} [options.goalId] - Goal ID for created tasks
 * @returns {Object} Diagnosis report
 */
async function runDiagnosis(options = {}) {
  const since = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Get event counts
  const counts = await getEventCounts(since);
  const countMap = {};
  for (const row of counts) {
    countMap[row.event_type] = parseInt(row.count);
  }

  const dispatched = countMap.task_dispatched || 0;
  const completed = countMap.task_completed || 0;
  const failed = countMap.task_failed || 0;
  const patrolCleanups = countMap.patrol_cleanup || 0;
  const circuitOpens = countMap.circuit_open || 0;

  const totalFinished = completed + failed;
  const successRate = totalFinished > 0 ? Math.round((completed / totalFinished) * 100) : 0;
  const failureRate = totalFinished > 0 ? Math.round((failed / totalFinished) * 100) : 0;

  // 2. Get task duration stats
  const durationResult = await pool.query(`
    SELECT
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds,
      MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_duration_seconds,
      MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_duration_seconds
    FROM tasks
    WHERE status = 'completed'
      AND completed_at >= $1
      AND started_at IS NOT NULL
  `, [since]);

  const durationStats = durationResult.rows[0] || {};
  const avgDuration = durationStats.avg_duration_seconds
    ? Math.round(parseFloat(durationStats.avg_duration_seconds))
    : null;

  // 3. Get circuit breaker states
  const circuitBreakers = getAllStates();

  // 4. Get slowest KRs (least progress)
  const slowKRs = await pool.query(`
    SELECT id, title, progress, priority
    FROM goals
    WHERE type = 'key_result'
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY progress ASC
    LIMIT 5
  `);

  // 5. Get most-failed tasks
  const failedTasks = await pool.query(`
    SELECT goal_id, COUNT(*) as fail_count
    FROM tasks
    WHERE status = 'failed'
      AND updated_at >= $1
    GROUP BY goal_id
    ORDER BY fail_count DESC
    LIMIT 5
  `, [since]);

  // 6. Generate recommendations
  const recommendations = [];

  if (failureRate > 50) {
    recommendations.push({
      severity: 'high',
      message: `Failure rate is ${failureRate}% — investigate root causes before scaling up`,
      action: 'Reduce concurrent tasks or fix failing task patterns'
    });
  } else if (failureRate > 25) {
    recommendations.push({
      severity: 'medium',
      message: `Failure rate is ${failureRate}% — some tasks need attention`,
      action: 'Review failed task logs for common patterns'
    });
  }

  if (patrolCleanups > 5) {
    recommendations.push({
      severity: 'medium',
      message: `${patrolCleanups} patrol cleanups in period — tasks are timing out frequently`,
      action: 'Increase DISPATCH_TIMEOUT_MINUTES or investigate slow tasks'
    });
  }

  if (circuitOpens > 0) {
    recommendations.push({
      severity: 'high',
      message: `Circuit breaker opened ${circuitOpens} times — worker instability detected`,
      action: 'Check executor logs and task complexity'
    });
  }

  const openBreakers = Object.entries(circuitBreakers)
    .filter(([, v]) => v.state === 'OPEN')
    .map(([k]) => k);
  if (openBreakers.length > 0) {
    recommendations.push({
      severity: 'critical',
      message: `Circuit breakers currently OPEN: ${openBreakers.join(', ')}`,
      action: 'Manual intervention required — reset after fixing root cause'
    });
  }

  if (dispatched === 0) {
    recommendations.push({
      severity: 'medium',
      message: 'No tasks dispatched in period — tick may be idle',
      action: 'Check if tick is enabled and there are queued tasks'
    });
  }

  for (const kr of slowKRs.rows) {
    if ((kr.progress || 0) < 20 && kr.priority === 'P0') {
      recommendations.push({
        severity: 'medium',
        message: `P0 KR "${kr.title}" at ${kr.progress}% — needs acceleration`,
        action: `Focus more tasks on this KR`
      });
    }
  }

  // 7. Build report
  const report = {
    period: { since, until: new Date().toISOString() },
    metrics: {
      tasks_dispatched: dispatched,
      tasks_completed: completed,
      tasks_failed: failed,
      success_rate: successRate,
      failure_rate: failureRate,
      patrol_cleanups: patrolCleanups,
      circuit_opens: circuitOpens,
      avg_duration_seconds: avgDuration
    },
    circuit_breakers: circuitBreakers,
    slowest_krs: slowKRs.rows.map(kr => ({
      id: kr.id,
      title: kr.title,
      progress: kr.progress || 0,
      priority: kr.priority
    })),
    most_failed_goals: failedTasks.rows,
    recommendations,
    generated_at: new Date().toISOString()
  };

  // 8. Optionally create improvement tasks
  if (options.createTasks && recommendations.length > 0) {
    const tasksCreated = [];
    for (const rec of recommendations.filter(r => r.severity === 'high' || r.severity === 'critical')) {
      const insertResult = await pool.query(`
        INSERT INTO tasks (title, description, priority, project_id, goal_id, status, payload)
        VALUES ($1, $2, $3, $4, $5, 'queued', $6) RETURNING id, title
      `, [
        `[Self-Diagnosis] ${rec.action}`,
        `Auto-generated from self-diagnosis: ${rec.message}`,
        rec.severity === 'critical' ? 'P0' : 'P1',
        options.projectId || null,
        options.goalId || null,
        JSON.stringify({ auto_generated: true, source: 'self-diagnosis', severity: rec.severity })
      ]);
      tasksCreated.push(insertResult.rows[0]);
    }
    report.tasks_created = tasksCreated;
  }

  // 9. Send daily summary notification
  try {
    await notifyDailySummary({
      completed,
      failed,
      planned: dispatched - totalFinished,
      circuit_breakers: circuitBreakers
    });
  } catch (_) {
    // ignore notification errors
  }

  return report;
}

export { runDiagnosis };
