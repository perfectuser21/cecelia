import { Router } from 'express';
import { readFileSync } from 'fs';
import pool from '../db.js';
import {
  executeOkrTick, runOkrTickSafe, startOkrTickLoop, stopOkrTickLoop, getOkrTickStatus,
  addQuestionToGoal, answerQuestionForGoal, getPendingQuestions, OKR_STATUS
} from '../okr-tick.js';
import {
  executeNightlyAlignment, runNightlyAlignmentSafe, startNightlyScheduler, stopNightlyScheduler,
  getNightlyTickStatus, getDailyReports
} from '../nightly-tick.js';
import { ensureEventsTable, queryEvents, getEventCounts } from '../event-bus.js';
import { getState as getCBState, reset as resetCB, getAllStates as getAllCBStates } from '../circuit-breaker.js';
import { getCurrentAlertness, setManualOverride, clearManualOverride, ALERTNESS_LEVELS, LEVEL_NAMES } from '../alertness/index.js';
import { getDispatchStats } from '../dispatch-stats.js';
import { getCleanupStats, runTaskCleanup, getCleanupAuditLog } from '../task-cleanup.js';
import { getTickStatus } from '../tick.js';
import { createProposal, approveProposal, rollbackProposal, rejectProposal, getProposal, listProposals } from '../proposal.js';
import { probe as dockerRuntimeProbe } from '../docker-runtime-probe.js';

// Constants previously in old alertness.js
const EVENT_BACKLOG_THRESHOLD = 50;
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));

const router = Router();


// ==================== Events API (EventBus) ====================

/**
 * GET /api/brain/events
 * Query event stream with optional filters
 */
router.get('/events', async (req, res) => {
  try {
    await ensureEventsTable();
    const { event_type, source, limit, since } = req.query;
    const events = await queryEvents({
      eventType: event_type,
      source,
      limit: limit ? parseInt(limit) : 50,
      since
    });
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to query events', details: err.message });
  }
});

/**
 * GET /api/brain/events/counts
 * Get event counts by type since a given time
 */
router.get('/events/counts', async (req, res) => {
  try {
    await ensureEventsTable();
    const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const counts = await getEventCounts(since);
    res.json({ success: true, since, counts });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get event counts', details: err.message });
  }
});

// ==================== Circuit Breaker API ====================

/**
 * GET /api/brain/circuit-breaker
 * Get all circuit breaker states
 */
router.get('/circuit-breaker', (req, res) => {
  res.json({ success: true, breakers: getAllCBStates() });
});

/**
 * POST /api/brain/circuit-breaker/:key/reset
 * Force reset a circuit breaker
 */
router.post('/circuit-breaker/:key/reset', (req, res) => {
  resetCB(req.params.key);
  res.json({ success: true, key: req.params.key, state: getCBState(req.params.key) });
});

// ==================== Health Check API ====================

/**
 * GET /api/brain/health
 * One-stop health check for all Cecelia organs
 */
router.get('/health', async (req, res) => {
  try {
    const [tickStatus, cbStates, activePipelinesResult, evaluatorStatsResult, docker_runtime] = await Promise.all([
      getTickStatus(),
      Promise.resolve(getAllCBStates()),
      pool.query("SELECT count(*)::integer AS cnt FROM tasks WHERE task_type='harness_planner' AND status='in_progress'"),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed')::integer AS passed,
          COUNT(*) FILTER (WHERE status IN ('canceled', 'failed'))::integer AS failed,
          MAX(completed_at) AS last_run_at
        FROM tasks
        WHERE task_type = 'harness_evaluate'
          AND status IN ('completed', 'canceled', 'failed')
      `).catch(() => null),
      dockerRuntimeProbe().catch((err) => ({
        enabled: true,
        status: 'unhealthy',
        reachable: false,
        version: null,
        error: err && err.message ? err.message : 'docker probe failed',
      }))
    ]);

    const esRow = evaluatorStatsResult?.rows?.[0] ?? null;
    const evaluatorStats = {
      total_runs: (esRow ? (esRow.passed + esRow.failed) : 0),
      passed: esRow ? esRow.passed : 0,
      failed: esRow ? esRow.failed : 0,
      last_run_at: esRow?.last_run_at ? new Date(esRow.last_run_at).toISOString() : null
    };

    const openBreakers = Object.entries(cbStates)
      .filter(([, v]) => v.state === 'OPEN')
      .map(([k]) => k);

    const halfOpenBreakers = Object.entries(cbStates)
      .filter(([, v]) => v.state === 'HALF_OPEN')
      .map(([k]) => k);

    // 聚合规则：docker_runtime.enabled=true && status='unhealthy' ⇒ 顶层 degraded；
    // status='disabled' 单独不触发 degraded（仅追加字段，不降级）
    const dockerDegraded = !!(docker_runtime && docker_runtime.enabled === true && docker_runtime.status === 'unhealthy');
    const healthy = tickStatus.loop_running && openBreakers.length === 0 && !dockerDegraded;

    let cbStatus;
    if (openBreakers.length > 0) {
      cbStatus = 'has_open';
    } else if (halfOpenBreakers.length > 0) {
      cbStatus = 'recovering';
    } else {
      cbStatus = 'all_closed';
    }

    res.json({
      status: healthy ? 'healthy' : 'degraded',
      uptime: Math.floor(process.uptime()),
      active_pipelines: activePipelinesResult.rows[0].cnt,
      evaluator_stats: evaluatorStats,
      tick_stats: tickStatus.tick_stats || { total_executions: 0, last_executed_at: null, last_duration_ms: null },
      organs: {
        scheduler: {
          status: tickStatus.loop_running ? 'running' : 'stopped',
          enabled: tickStatus.enabled,
          last_tick: tickStatus.last_tick,
          max_concurrent: tickStatus.max_concurrent
        },
        circuit_breaker: {
          status: cbStatus,
          open: openBreakers,
          half_open: halfOpenBreakers,
          states: cbStates
        },
        event_bus: { status: 'active' },
        notifier: { status: process.env.FEISHU_BOT_WEBHOOK ? 'configured' : 'unconfigured' },
        planner: { status: 'v2' }
      },
      docker_runtime,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

/**
 * GET /api/brain/credentials/status
 * 返回所有 Claude 账号的 OAuth token 过期状态
 */
router.get('/credentials/status', async (req, res) => {
  try {
    const { checkCredentialExpiry } = await import('../credential-expiry-checker.js');
    const result = checkCredentialExpiry();
    const enriched = result.accounts.map(a => ({
      account: a.account,
      status: a.status,
      expires_at: a.expiresAt || null,
      remaining_hours: a.remainingMs != null ? Math.floor(a.remainingMs / 3600000) : null,
      remaining_minutes: a.remainingMs != null ? Math.floor((a.remainingMs % 3600000) / 60000) : null,
      error: a.error || null,
    }));
    res.json({
      success: true,
      alert_needed: result.alertNeeded,
      critical_count: result.criticalAccounts.length,
      accounts: enriched,
      checked_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Self-Diagnosis API — removed (self-diagnosis.js deleted, diagnosis now handled by cortex.js L2)

// ==================== Blocks API (Notion-like Page Content) ====================

/**
 * GET /api/brain/blocks/:parentType/:parentId
 * Get all blocks for a parent entity (goal, task, project, or block)
 */
router.get('/blocks/:parentType/:parentId', async (req, res) => {
  try {
    const { parentType, parentId } = req.params;

    // Validate parent type
    const validTypes = ['goal', 'task', 'project', 'block', 'knowledge'];
    if (!validTypes.includes(parentType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid parent_type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const result = await pool.query(`
      SELECT id, parent_id, parent_type, type, content, order_index, created_at, updated_at
      FROM blocks
      WHERE parent_id = $1 AND parent_type = $2
      ORDER BY order_index ASC
    `, [parentId, parentType]);

    res.json({ success: true, blocks: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get blocks', details: err.message });
  }
});

/**
 * POST /api/brain/blocks
 * Create a new block
 */
router.post('/blocks', async (req, res) => {
  try {
    const { parent_id, parent_type, type, content, order_index } = req.body;

    // Validate required fields
    if (!parent_id || !parent_type || !type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: parent_id, parent_type, type'
      });
    }

    // Validate parent type
    const validParentTypes = ['goal', 'task', 'project', 'block', 'knowledge'];
    if (!validParentTypes.includes(parent_type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid parent_type. Must be one of: ${validParentTypes.join(', ')}`
      });
    }

    // Validate block type
    const validBlockTypes = [
      'paragraph', 'heading_1', 'heading_2', 'heading_3',
      'bulleted_list', 'numbered_list', 'to_do',
      'code', 'quote', 'callout', 'divider', 'image', 'toggle'
    ];
    if (!validBlockTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid block type. Must be one of: ${validBlockTypes.join(', ')}`
      });
    }

    // Get max order_index if not provided
    let finalOrderIndex = order_index;
    if (finalOrderIndex === undefined || finalOrderIndex === null) {
      const maxResult = await pool.query(`
        SELECT COALESCE(MAX(order_index), -1) + 1 as next_index
        FROM blocks
        WHERE parent_id = $1 AND parent_type = $2
      `, [parent_id, parent_type]);
      finalOrderIndex = maxResult.rows[0].next_index;
    }

    const result = await pool.query(`
      INSERT INTO blocks (parent_id, parent_type, type, content, order_index)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [parent_id, parent_type, type, content || {}, finalOrderIndex]);

    res.json({ success: true, block: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create block', details: err.message });
  }
});

/**
 * PUT /api/brain/blocks/reorder
 * Batch reorder blocks (must be before :id route)
 * Body: { blocks: [{ id, order_index }, ...] }
 */
router.put('/blocks/reorder', async (req, res) => {
  try {
    const { blocks } = req.body;

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'blocks must be a non-empty array of { id, order_index }'
      });
    }

    // Validate each item
    for (const block of blocks) {
      if (!block.id || block.order_index === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Each block must have id and order_index'
        });
      }
    }

    // Use transaction for batch update
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const block of blocks) {
        await client.query(`
          UPDATE blocks SET order_index = $1, updated_at = NOW() WHERE id = $2
        `, [block.order_index, block.id]);
      }

      await client.query('COMMIT');
      res.json({ success: true, updated: blocks.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to reorder blocks', details: err.message });
  }
});

/**
 * PUT /api/brain/blocks/:id
 * Update a block
 */
router.put('/blocks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, content, order_index } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (type !== undefined) {
      const validBlockTypes = [
        'paragraph', 'heading_1', 'heading_2', 'heading_3',
        'bulleted_list', 'numbered_list', 'to_do',
        'code', 'quote', 'callout', 'divider', 'image', 'toggle'
      ];
      if (!validBlockTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid block type. Must be one of: ${validBlockTypes.join(', ')}`
        });
      }
      updates.push(`type = $${paramIndex++}`);
      values.push(type);
    }

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(content);
    }

    if (order_index !== undefined) {
      updates.push(`order_index = $${paramIndex++}`);
      values.push(order_index);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(`
      UPDATE blocks
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Block not found' });
    }

    res.json({ success: true, block: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update block', details: err.message });
  }
});

/**
 * DELETE /api/brain/blocks/:id
 * Delete a block
 */
router.delete('/blocks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM blocks WHERE id = $1 RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Block not found' });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete block', details: err.message });
  }
});

// ==================== OKR Tick API ====================

/**
 * GET /api/brain/okr-tick/status
 * Get OKR tick loop status
 */
router.get('/okr-tick/status', (req, res) => {
  res.json({ success: true, ...getOkrTickStatus() });
});

/**
 * POST /api/brain/okr-tick
 * Manually trigger OKR tick
 */
router.post('/okr-tick', async (req, res) => {
  try {
    const result = await runOkrTickSafe();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'OKR tick failed', details: err.message });
  }
});

/**
 * POST /api/brain/okr-tick/enable
 * Enable OKR tick loop
 */
router.post('/okr-tick/enable', (req, res) => {
  const started = startOkrTickLoop();
  res.json({ success: true, started, ...getOkrTickStatus() });
});

/**
 * POST /api/brain/okr-tick/disable
 * Disable OKR tick loop
 */
router.post('/okr-tick/disable', (req, res) => {
  const stopped = stopOkrTickLoop();
  res.json({ success: true, stopped, ...getOkrTickStatus() });
});

// ==================== OKR Question API ====================

/**
 * GET /api/brain/okr/:id/questions
 * Get pending questions for a goal
 */
router.get('/okr/:id/questions', async (req, res) => {
  try {
    const { id } = req.params;
    const questions = await getPendingQuestions(id);
    res.json({ success: true, goal_id: id, questions });
  } catch (err) {
    const status = err.message === 'Goal not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/okr/:id/question
 * Add a question to a goal
 */
router.post('/okr/:id/question', async (req, res) => {
  try {
    const { id } = req.params;
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'question is required' });
    }

    const result = await addQuestionToGoal(id, question);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to add question', details: err.message });
  }
});

/**
 * PUT /api/brain/okr/:id/answer
 * Answer a question for a goal
 */
router.put('/okr/:id/answer', async (req, res) => {
  try {
    const { id } = req.params;
    const { question_id, answer } = req.body;

    if (!question_id || !answer) {
      return res.status(400).json({ success: false, error: 'question_id and answer are required' });
    }

    const result = await answerQuestionForGoal(id, question_id, answer);
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/okr/statuses
 * Get available OKR status values
 */
router.get('/okr/statuses', (req, res) => {
  res.json({ success: true, statuses: OKR_STATUS });
});

// ==================== Nightly Tick API ====================

/**
 * GET /api/brain/nightly/status
 * Get nightly tick scheduler status
 */
router.get('/nightly/status', (req, res) => {
  res.json({ success: true, ...getNightlyTickStatus() });
});

/**
 * POST /api/brain/nightly/trigger
 * Manually trigger nightly alignment
 */
router.post('/nightly/trigger', async (req, res) => {
  try {
    const result = await runNightlyAlignmentSafe();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Nightly alignment failed', details: err.message });
  }
});

/**
 * POST /api/brain/nightly/enable
 * Enable nightly scheduler
 */
router.post('/nightly/enable', (req, res) => {
  const started = startNightlyScheduler();
  res.json({ success: true, started, ...getNightlyTickStatus() });
});

/**
 * POST /api/brain/nightly/disable
 * Disable nightly scheduler
 */
router.post('/nightly/disable', (req, res) => {
  const stopped = stopNightlyScheduler();
  res.json({ success: true, stopped, ...getNightlyTickStatus() });
});

// ==================== Daily Reports API ====================

/**
 * GET /api/brain/daily-reports
 * Get daily reports
 */
router.get('/daily-reports', async (req, res) => {
  try {
    const { date = 'today', type = 'all' } = req.query;
    const reports = await getDailyReports(date, type);
    res.json({ success: true, date, type, reports });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get daily reports', details: err.message });
  }
});

/**
 * GET /api/brain/daily-reports/:date
 * Get daily reports for a specific date
 */
router.get('/daily-reports/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { type = 'all' } = req.query;
    const reports = await getDailyReports(date, type);
    res.json({ success: true, date, type, reports });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get daily reports', details: err.message });
  }
});

/**
 * GET /api/brain/daily-reports/:date/summary
 * Get summary report for a specific date
 */
router.get('/daily-reports/:date/summary', async (req, res) => {
  try {
    const { date } = req.params;
    const reports = await getDailyReports(date, 'summary');
    const summary = reports.find(r => r.type === 'summary');

    if (!summary) {
      return res.status(404).json({ success: false, error: 'Summary not found for this date' });
    }

    res.json({ success: true, date, summary: summary.content });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get summary', details: err.message });
  }
});


// ==================== Hardening Status Dashboard ====================

/**
 * GET /api/brain/hardening/status
 * One-eye dashboard: aggregates all 6 stability hardening features
 */
router.get('/hardening/status', async (req, res) => {
  try {
    const version = pkg.version;
    const checked_at = new Date().toISOString();

    const [
      decisionStats,
      lastRollback,
      failureStats,
      backlogCurrent,
      backlogPeak,
      alertness,
      decay,
      pendingStats,
      llmErrorStats,
    ] = await Promise.all([
      // 1. Transactional decisions: recent 10
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'success') AS committed,
          COUNT(*) FILTER (WHERE status = 'failed') AS rolled_back
        FROM (
          SELECT status FROM decision_log ORDER BY created_at DESC LIMIT 10
        ) t
      `).catch(() => ({ rows: [{ committed: 0, rolled_back: 0 }] })),

      // 2. Last rollback event
      pool.query(`
        SELECT payload, created_at FROM cecelia_events
        WHERE event_type = 'decision_rollback'
        ORDER BY created_at DESC LIMIT 1
      `).catch(() => ({ rows: [] })),

      // 3. Failure classification: last 1h
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE payload->>'failure_class' = 'systemic') AS systemic,
          COUNT(*) FILTER (WHERE payload->>'failure_class' = 'task_specific') AS task_specific,
          COUNT(*) FILTER (WHERE payload->>'failure_class' = 'unknown' OR payload->>'failure_class' IS NULL) AS unknown
        FROM cecelia_events
        WHERE event_type = 'task_failure'
          AND created_at > NOW() - INTERVAL '1 hour'
      `).catch(() => ({ rows: [{ systemic: 0, task_specific: 0, unknown: 0 }] })),

      // 4. Event backlog: current 10min
      pool.query(`
        SELECT COUNT(*) AS count FROM cecelia_events
        WHERE created_at > NOW() - INTERVAL '10 minutes'
      `).catch(() => ({ rows: [{ count: 0 }] })),

      // 5. Event backlog: peak 24h (max events in any 10-min window)
      pool.query(`
        SELECT COALESCE(MAX(cnt), 0) AS peak FROM (
          SELECT COUNT(*) AS cnt
          FROM cecelia_events
          WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY date_trunc('hour', created_at), (EXTRACT(EPOCH FROM created_at)::int / 600)
        ) t
      `).catch(() => ({ rows: [{ peak: 0 }] })),

      // 6. Alertness state (sync)
      Promise.resolve(getCurrentAlertness()),

      // 7. Decay status (deprecated - unified alertness has no decay)
      Promise.resolve({ accumulated_score: 0 }),

      // 8. Pending actions stats
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending_approval' AND (expires_at IS NULL OR expires_at > NOW())) AS pending,
          COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_at > NOW() - INTERVAL '24 hours') AS approved_24h,
          COUNT(*) FILTER (WHERE status = 'rejected' AND reviewed_at > NOW() - INTERVAL '24 hours') AS rejected_24h,
          COUNT(*) FILTER (WHERE status = 'expired' AND reviewed_at > NOW() - INTERVAL '24 hours') AS expired_24h
        FROM pending_actions
      `).catch(() => ({ rows: [{ pending: 0, approved_24h: 0, rejected_24h: 0, expired_24h: 0 }] })),

      // 9. LLM errors: last 1h by type
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE event_type = 'llm_api_error') AS api_error,
          COUNT(*) FILTER (WHERE event_type = 'llm_bad_output') AS bad_output,
          COUNT(*) FILTER (WHERE event_type = 'llm_timeout') AS timeout
        FROM cecelia_events
        WHERE event_type IN ('llm_api_error', 'llm_bad_output', 'llm_timeout')
          AND created_at > NOW() - INTERVAL '1 hour'
      `).catch(() => ({ rows: [{ api_error: 0, bad_output: 0, timeout: 0 }] })),
    ]);

    const dRow = decisionStats.rows[0];
    const fRow = failureStats.rows[0];
    const pRow = pendingStats.rows[0];
    const lRow = llmErrorStats.rows[0];
    const lastRb = lastRollback.rows[0] || null;

    // Recovery gate calculation (unified alertness: 60s cooldown)
    const currentLevel = alertness.level;
    let recoveryGate = null;
    if (currentLevel > 0) {
      const COOLDOWN_MS = 60 * 1000; // 1 minute cooldown per the unified alertness system
      const elapsed = Date.now() - new Date(alertness.startedAt).getTime();
      const remaining = Math.max(0, COOLDOWN_MS - elapsed);
      if (remaining > 0) {
        const targetLevel = currentLevel - 1;
        recoveryGate = {
          target: LEVEL_NAMES[targetLevel],
          remaining_ms: remaining,
        };
      }
    }

    // Compute overall_status: critical > warn > ok
    // Unified levels: SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4
    const systemicCount = parseInt(fRow.systemic);
    const backlogCount = parseInt(backlogCurrent.rows[0].count);
    let overall_status = 'ok';
    if (currentLevel >= ALERTNESS_LEVELS.PANIC || systemicCount >= 5 || backlogCount >= EVENT_BACKLOG_THRESHOLD * 2) {
      overall_status = 'critical';
    } else if (currentLevel >= ALERTNESS_LEVELS.AWARE || systemicCount >= 2 || backlogCount >= EVENT_BACKLOG_THRESHOLD || parseInt(pRow.pending) >= 3) {
      overall_status = 'warn';
    }

    res.json({
      version,
      checked_at,
      overall_status,
      features: {
        transactional_decisions: {
          enabled: true,
          recent_10: {
            committed: parseInt(dRow.committed),
            rolled_back: parseInt(dRow.rolled_back),
          },
          last_rollback: lastRb ? {
            at: lastRb.created_at,
            error: lastRb.payload?.error || null,
          } : null,
        },
        failure_classification: {
          enabled: true,
          last_1h: {
            systemic: parseInt(fRow.systemic),
            task_specific: parseInt(fRow.task_specific),
            unknown: parseInt(fRow.unknown),
          },
        },
        event_backlog: {
          enabled: true,
          current_10min: parseInt(backlogCurrent.rows[0].count),
          threshold: EVENT_BACKLOG_THRESHOLD,
          peak_24h: parseInt(backlogPeak.rows[0].peak),
        },
        alertness_decay: {
          enabled: true,
          current_score: {
            raw: decay.accumulated_score,
            decayed: decay.accumulated_score,
          },
          level: LEVEL_NAMES[currentLevel],
          recovery_gate: recoveryGate,
        },
        pending_actions: {
          enabled: true,
          pending: parseInt(pRow.pending),
          approved_24h: parseInt(pRow.approved_24h),
          rejected_24h: parseInt(pRow.rejected_24h),
          expired_24h: parseInt(pRow.expired_24h),
        },
        llm_errors: {
          enabled: true,
          last_1h: {
            api_error: parseInt(lRow.api_error),
            bad_output: parseInt(lRow.bad_output),
            timeout: parseInt(lRow.timeout),
          },
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get hardening status', details: err.message });
  }
});

// ==================== Plan Proposal 系统 ====================

/**
 * POST /api/brain/proposals — Create a new proposal
 * Accepts both LLM proposals and user UI operations.
 */
router.post('/proposals', async (req, res) => {
  try {
    const proposal = await createProposal(req.body);
    res.json(proposal);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/brain/proposals — List proposals
 */
router.get('/proposals', async (req, res) => {
  try {
    const { status, limit } = req.query;
    const proposals = await listProposals({ status, limit: parseInt(limit) || 20 });
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/proposals/:id — Get single proposal
 */
router.get('/proposals/:id', async (req, res) => {
  try {
    const proposal = await getProposal(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    res.json(proposal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/proposals/:id/approve — Approve and apply a proposal
 */
router.post('/proposals/:id/approve', async (req, res) => {
  try {
    const result = await approveProposal(req.params.id, req.body.approved_by || 'user');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/brain/proposals/:id/reject — Reject a proposal
 */
router.post('/proposals/:id/reject', async (req, res) => {
  try {
    const result = await rejectProposal(req.params.id, req.body.reason || '');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/brain/proposals/:id/rollback — Rollback an applied proposal
 */
router.post('/proposals/:id/rollback', async (req, res) => {
  try {
    const result = await rollbackProposal(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/brain/okr/verifiers/run — 强制立即执行所有启用的 KR verifiers
 * 用途：跳过小时级内存锁，运维/测试时手动触发采集
 */
router.post('/okr/verifiers/run', async (req, res) => {
  try {
    const { runAllVerifiers } = await import('../kr-verifier.js');
    const result = await runAllVerifiers();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/okr/verifiers/health — KR verifier 可信度校验报告
 * 返回所有 active KR verifier 的健康状态（healthy/warn/critical）
 * 用途：运维巡检、每日可信度审计
 */
router.get('/okr/verifiers/health', async (req, res) => {
  try {
    const { getKrVerifierHealth } = await import('../kr-verifier.js');
    const result = await getKrVerifierHealth();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
