/**
 * Nightly Tick - Daily Alignment & Reporting
 * Runs at 22:00 to generate daily reports and align departments
 */

import pool from './db.js';
import { emit } from './event-bus.js';

// Nightly tick configuration
const NIGHTLY_HOUR = parseInt(process.env.CECELIA_NIGHTLY_HOUR || '22', 10);
const NIGHTLY_MINUTE = parseInt(process.env.CECELIA_NIGHTLY_MINUTE || '0', 10);

// Loop state
let _nightlyTimer = null;
let _nightlyRunning = false;

/**
 * Get active projects with their task statistics
 */
async function getActiveProjectsWithStats() {
  const result = await pool.query(`
    SELECT
      p.id,
      p.name,
      p.repo_path,
      p.lead_agent,
      COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.completed_at >= CURRENT_DATE) as completed_today,
      COUNT(t.id) FILTER (WHERE t.status = 'in_progress') as in_progress,
      COUNT(t.id) FILTER (WHERE t.status = 'queued') as queued,
      COUNT(t.id) FILTER (WHERE t.status = 'failed' AND t.updated_at >= CURRENT_DATE) as failed_today
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
    GROUP BY p.id, p.name, p.repo_path, p.lead_agent
    HAVING COUNT(t.id) > 0 OR p.lead_agent IS NOT NULL
    ORDER BY p.name
  `);
  return result.rows;
}

/**
 * Get goals progress for today
 */
async function getGoalsProgress() {
  const result = await pool.query(`
    SELECT
      g.id,
      g.title,
      g.status,
      g.priority,
      g.progress,
      p.name as project_name
    FROM goals g
    LEFT JOIN projects p ON g.project_id = p.id
    WHERE g.status NOT IN ('completed', 'cancelled')
    ORDER BY g.priority ASC, g.progress DESC
    LIMIT 20
  `);
  return result.rows;
}

/**
 * Get today's reflections (issues, learnings, improvements)
 */
async function getTodaysReflections() {
  const result = await pool.query(`
    SELECT
      r.id,
      r.type,
      r.title,
      r.content,
      r.tags,
      p.name as project_name
    FROM reflections r
    LEFT JOIN projects p ON r.project_id = p.id
    WHERE r.created_at >= CURRENT_DATE
    ORDER BY r.created_at DESC
  `);
  return result.rows;
}

/**
 * Generate daily report for a project
 * @param {Object} project - Project with stats
 */
function generateProjectReport(project) {
  return {
    project_id: project.id,
    project_name: project.name,
    lead_agent: project.lead_agent,
    summary: {
      completed_today: parseInt(project.completed_today) || 0,
      in_progress: parseInt(project.in_progress) || 0,
      queued: parseInt(project.queued) || 0,
      failed_today: parseInt(project.failed_today) || 0
    },
    health: calculateProjectHealth(project),
    generated_at: new Date().toISOString()
  };
}

/**
 * Calculate project health based on stats
 */
function calculateProjectHealth(project) {
  const failed = parseInt(project.failed_today) || 0;
  const completed = parseInt(project.completed_today) || 0;
  const inProgress = parseInt(project.in_progress) || 0;

  if (failed > 2) return 'critical';
  if (failed > 0) return 'warning';
  if (completed > 0 && inProgress > 0) return 'healthy';
  if (inProgress === 0 && completed === 0) return 'idle';
  return 'healthy';
}

/**
 * Save daily log to database
 * @param {string|null} projectId - Project UUID or null for summary
 * @param {Object} report - Report content
 * @param {string} type - 'repo' or 'summary'
 * @param {string} agent - Agent name that generated the report
 */
async function saveDailyLog(projectId, report, type = 'repo', agent = 'nightly-tick') {
  const today = new Date().toISOString().split('T')[0];

  // Check if already exists for today
  const existing = await pool.query(`
    SELECT id FROM daily_logs
    WHERE date = $1 AND project_id IS NOT DISTINCT FROM $2 AND type = $3
  `, [today, projectId, type]);

  const reportJson = typeof report === 'string' ? report : JSON.stringify(report);

  if (existing.rows.length > 0) {
    // Update existing
    await pool.query(`
      UPDATE daily_logs
      SET summary = $2, agent = $3
      WHERE id = $1
    `, [existing.rows[0].id, reportJson, agent]);
    return { updated: true, id: existing.rows[0].id };
  } else {
    // Insert new
    const result = await pool.query(`
      INSERT INTO daily_logs (date, project_id, summary, type, agent)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [today, projectId, reportJson, type, agent]);
    return { created: true, id: result.rows[0].id };
  }
}

/**
 * Execute nightly alignment
 * 1. Generate reports for each active project
 * 2. Generate summary report
 * 3. Save all to daily_logs
 */
async function executeNightlyAlignment() {
  const actionsTaken = [];
  const today = new Date().toISOString().split('T')[0];

  console.log(`[nightly-tick] Starting nightly alignment for ${today}`);

  // 1. Get active projects with stats
  const projects = await getActiveProjectsWithStats();

  // 2. Generate and save project reports
  const projectReports = [];
  for (const project of projects) {
    const report = generateProjectReport(project);
    projectReports.push(report);

    const saveResult = await saveDailyLog(project.id, report, 'repo');

    actionsTaken.push({
      action: 'save_project_report',
      project_id: project.id,
      project_name: project.name,
      health: report.health,
      ...saveResult
    });
  }

  // 3. Get goals progress
  const goalsProgress = await getGoalsProgress();

  // 4. Get today's reflections
  const reflections = await getTodaysReflections();

  // 5. Generate and save summary report
  const summaryReport = {
    date: today,
    generated_at: new Date().toISOString(),
    projects_summary: {
      total: projects.length,
      healthy: projectReports.filter(r => r.health === 'healthy').length,
      warning: projectReports.filter(r => r.health === 'warning').length,
      critical: projectReports.filter(r => r.health === 'critical').length,
      idle: projectReports.filter(r => r.health === 'idle').length
    },
    tasks_summary: {
      completed_today: projectReports.reduce((sum, r) => sum + r.summary.completed_today, 0),
      failed_today: projectReports.reduce((sum, r) => sum + r.summary.failed_today, 0),
      in_progress: projectReports.reduce((sum, r) => sum + r.summary.in_progress, 0),
      queued: projectReports.reduce((sum, r) => sum + r.summary.queued, 0)
    },
    goals_progress: goalsProgress.map(g => ({
      id: g.id,
      title: g.title,
      status: g.status,
      priority: g.priority,
      progress: g.progress,
      project: g.project_name
    })),
    reflections_summary: {
      issues: reflections.filter(r => r.type === 'issue').length,
      learnings: reflections.filter(r => r.type === 'learning').length,
      improvements: reflections.filter(r => r.type === 'improvement').length
    },
    project_reports: projectReports
  };

  const summaryResult = await saveDailyLog(null, summaryReport, 'summary');

  actionsTaken.push({
    action: 'save_summary_report',
    ...summaryResult
  });

  // 6. Quality check: create review tasks for projects with completed work today
  const reviewsCreated = [];
  for (const report of projectReports) {
    if (report.summary.completed_today === 0) continue;

    // Dedup: skip if a nightly review task already exists for this project today
    const existingReview = await pool.query(`
      SELECT id FROM tasks
      WHERE project_id = $1
        AND task_type = 'review'
        AND (payload->>'nightly_review' = 'true')
        AND created_at >= CURRENT_DATE
    `, [report.project_id]);

    if (existingReview.rows.length > 0) continue;

    // Create review task — dispatched by normal tick loop
    const reviewResult = await pool.query(`
      INSERT INTO tasks (title, description, status, priority, project_id, task_type, payload, trigger_source)
      VALUES ($1, $2, 'queued', 'P1', $3, 'review', $4, 'brain_auto')
      RETURNING id
    `, [
      `每日质检: ${report.project_name} (${today})`,
      `每日质检任务，审查项目 ${report.project_name} 今日完成的 ${report.summary.completed_today} 个任务。\n\n检查要点：\n1. 代码质量：有无明显 bug、安全漏洞、性能问题\n2. 测试覆盖：新代码是否有对应测试\n3. 架构一致性：是否符合项目架构规范\n4. 回归风险：改动是否可能影响其他功能\n\n输出 REVIEW-REPORT.md 报告。`,
      report.project_id,
      JSON.stringify({ nightly_review: 'true', date: today, completed_count: report.summary.completed_today })
    ]);

    reviewsCreated.push({ project: report.project_name, task_id: reviewResult.rows[0].id });
    actionsTaken.push({
      action: 'create_review_task',
      project_name: report.project_name,
      task_id: reviewResult.rows[0].id
    });
  }

  if (reviewsCreated.length > 0) {
    console.log(`[nightly-tick] Created ${reviewsCreated.length} review tasks: ${reviewsCreated.map(r => r.project).join(', ')}`);
  }

  // 7. Emit event
  await emit('nightly_alignment_completed', 'nightly-tick', {
    date: today,
    projects_count: projects.length,
    summary: summaryReport.tasks_summary,
    reviews_created: reviewsCreated.length
  });

  console.log(`[nightly-tick] Completed: ${projects.length} projects, ${actionsTaken.length} actions, ${reviewsCreated.length} reviews`);

  return {
    success: true,
    date: today,
    projects_processed: projects.length,
    summary: summaryReport,
    actions_taken: actionsTaken
  };
}

/**
 * Run nightly alignment safely
 */
async function runNightlyAlignmentSafe() {
  if (_nightlyRunning) {
    console.log('[nightly-tick] Already running, skipping');
    return { skipped: true, reason: 'already_running' };
  }

  _nightlyRunning = true;

  try {
    const result = await executeNightlyAlignment();
    return result;
  } catch (err) {
    console.error('[nightly-tick] Failed:', err.message);
    return { success: false, error: err.message };
  } finally {
    _nightlyRunning = false;
  }
}

/**
 * Calculate milliseconds until next nightly run
 */
function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(NIGHTLY_HOUR, NIGHTLY_MINUTE, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

/**
 * Start nightly tick scheduler
 */
function startNightlyScheduler() {
  if (_nightlyTimer) {
    console.log('[nightly-tick] Scheduler already running');
    return false;
  }

  const scheduleNext = () => {
    const ms = msUntilNextRun();
    console.log(`[nightly-tick] Next run in ${Math.round(ms / 1000 / 60)} minutes`);

    _nightlyTimer = setTimeout(async () => {
      await runNightlyAlignmentSafe();
      scheduleNext(); // Schedule next day
    }, ms);

    if (_nightlyTimer.unref) {
      _nightlyTimer.unref();
    }
  };

  scheduleNext();
  console.log(`[nightly-tick] Scheduler started (daily at ${NIGHTLY_HOUR}:${String(NIGHTLY_MINUTE).padStart(2, '0')})`);
  return true;
}

/**
 * Stop nightly tick scheduler
 */
function stopNightlyScheduler() {
  if (!_nightlyTimer) {
    console.log('[nightly-tick] No scheduler running');
    return false;
  }

  clearTimeout(_nightlyTimer);
  _nightlyTimer = null;
  console.log('[nightly-tick] Scheduler stopped');
  return true;
}

/**
 * Get nightly tick status
 */
function getNightlyTickStatus() {
  return {
    scheduler_running: _nightlyTimer !== null,
    scheduled_hour: NIGHTLY_HOUR,
    scheduled_minute: NIGHTLY_MINUTE,
    tick_running: _nightlyRunning,
    next_run_ms: _nightlyTimer ? msUntilNextRun() : null
  };
}

/**
 * Get daily reports
 * @param {string} date - Date string (YYYY-MM-DD) or 'today'
 * @param {string} type - 'repo', 'summary', or 'all'
 */
async function getDailyReports(date = 'today', type = 'all') {
  const targetDate = date === 'today' ? new Date().toISOString().split('T')[0] : date;

  let query = `
    SELECT dl.*, p.name as project_name
    FROM daily_logs dl
    LEFT JOIN projects p ON dl.project_id = p.id
    WHERE dl.date = $1
  `;
  const params = [targetDate];

  if (type !== 'all') {
    query += ' AND dl.type = $2';
    params.push(type);
  }

  query += ' ORDER BY dl.type DESC, p.name ASC';

  const result = await pool.query(query, params);
  return result.rows;
}

export {
  executeNightlyAlignment,
  runNightlyAlignmentSafe,
  startNightlyScheduler,
  stopNightlyScheduler,
  getNightlyTickStatus,
  getDailyReports,
  saveDailyLog,
  getActiveProjectsWithStats,
  getGoalsProgress,
  getTodaysReflections,
  NIGHTLY_HOUR,
  NIGHTLY_MINUTE
};
