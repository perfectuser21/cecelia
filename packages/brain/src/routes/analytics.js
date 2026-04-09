import { Router } from 'express';
import pool from '../db.js';
import { syncSocialMediaData, getCollectionCoverage } from '../social-media-sync.js';
import { getMonthlyPRCount, getMonthlyPRsByKR, getPRSuccessRate, getPRTrend } from '../stats.js';
import { searchRelevantAnalyses } from '../cortex.js';
import {
  evaluateQualityInitial,
  checkShouldCreateRCA,
  getQualityStats,
} from '../cortex-quality.js';
import { runDecompositionChecks } from '../decomposition-checker.js';
import { getActiveExecutionPaths, INVENTORY_CONFIG } from './shared.js';
import {
  writeContentAnalytics,
  bulkWriteContentAnalytics,
  queryWeeklyROI,
  getTopContentByPlatform,
  upsertPipelinePublishStats,
} from '../content-analytics.js';
import { scheduleDailyScrape } from '../daily-scrape-scheduler.js';
import { getAccountUsage } from '../account-usage.js';

const router = Router();

/**
 * GET /api/brain/cortex/analyses
 * Query historical Cortex analyses
 *
 * Query params:
 * - task_id: Filter by task ID
 * - failure_class: Filter by failure class (NETWORK, BILLING_CAP, etc.)
 * - trigger_event: Filter by trigger event type
 * - limit: Max results (default 10)
 */
router.get('/cortex/analyses', async (req, res) => {
  try {
    const { task_id, failure_class, trigger_event, limit } = req.query;

    // If task_id is provided, query by task_id directly
    if (task_id) {
      const result = await pool.query(`
        SELECT * FROM cortex_analyses
        WHERE task_id = $1
        ORDER BY created_at DESC
      `, [task_id]);
      return res.json(result.rows);
    }

    // Otherwise, use semantic search
    const analyses = await searchRelevantAnalyses({
      failure_class,
      trigger_event
    }, parseInt(limit) || 10);

    res.json(analyses);
  } catch (err) {
    console.error('[API] Failed to query cortex analyses:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/cortex/analyses/:id
 * Get single analysis by ID
 */
router.get('/cortex/analyses/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM cortex_analyses WHERE id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[API] Failed to get cortex analysis:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/cortex/evaluate-quality
 * Evaluate quality for a specific analysis
 *
 * Body: { analysis_id: UUID, evaluation_type: 'initial'|'final' }
 */
router.post('/cortex/evaluate-quality', async (req, res) => {
  try {
    const { analysis_id, evaluation_type = 'initial' } = req.body;

    if (!analysis_id) {
      return res.status(400).json({ error: 'analysis_id required' });
    }

    const result = await evaluateQualityInitial(analysis_id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Failed to evaluate quality:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/cortex/check-similarity
 * Check if RCA should be created or reused
 *
 * Body: { task_type, reason, root_cause }
 */
router.post('/cortex/check-similarity', async (req, res) => {
  try {
    const { task_type, reason, root_cause } = req.body;

    const result = await checkShouldCreateRCA({
      task_type,
      reason,
      root_cause: root_cause || ''
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Failed to check similarity:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/cortex/quality-stats
 * Get quality statistics for a time period
 *
 * Query params: days (default: 7)
 */
router.get('/cortex/quality-stats', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '7');
    const stats = await getQualityStats(days);

    res.json({ success: true, ...stats });
  } catch (err) {
    console.error('[API] Failed to get quality stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/cortex/feedback
 * Record user feedback for an RCA analysis
 *
 * Body: { analysis_id: UUID, rating: number (1-5), comment?: string }
 */
router.post('/cortex/feedback', async (req, res) => {
  try {
    const { analysis_id, rating, comment } = req.body;

    if (!analysis_id) {
      return res.status(400).json({ error: 'analysis_id required' });
    }

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be a number between 1 and 5' });
    }

    const { recordQualityFeedback, updateEffectivenessScore } = await import('../cortex-quality.js');

    // Record feedback
    await recordQualityFeedback(analysis_id, rating, comment);

    // Update effectiveness score
    const result = await updateEffectivenessScore(analysis_id);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Failed to record feedback:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/cortex/stats
 * 返回最近 24h Cortex LLM 调用统计（超时率、平均耗时等）
 *
 * Query params: hours (default: 24, max: 168)
 */
router.get('/cortex/stats', async (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours || '24', 10)));
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_calls,
        COUNT(*) FILTER (WHERE (metadata->>'timed_out')::boolean = true) AS timeout_count,
        ROUND(
          COUNT(*) FILTER (WHERE (metadata->>'timed_out')::boolean = true) * 100.0
          / NULLIF(COUNT(*), 0),
          2
        ) AS timeout_rate_pct,
        ROUND(AVG((metadata->>'response_ms')::numeric) FILTER (WHERE metadata->>'response_ms' IS NOT NULL), 0) AS avg_response_ms,
        ROUND(MAX((metadata->>'response_ms')::numeric) FILTER (WHERE metadata->>'response_ms' IS NOT NULL), 0) AS max_response_ms,
        ROUND(AVG((metadata->>'prompt_tokens_est')::numeric) FILTER (WHERE metadata->>'prompt_tokens_est' IS NOT NULL), 0) AS avg_prompt_tokens_est
      FROM decision_log
      WHERE trigger = 'cortex'
        AND metadata IS NOT NULL
        AND created_at > NOW() - ($1 || ' hours')::interval
    `, [hours]);

    const row = result.rows[0];
    res.json({
      success: true,
      period_hours: hours,
      total_calls: parseInt(row.total_calls, 10),
      timeout_count: parseInt(row.timeout_count, 10),
      timeout_rate_pct: parseFloat(row.timeout_rate_pct) || 0,
      avg_response_ms: parseInt(row.avg_response_ms, 10) || null,
      max_response_ms: parseInt(row.max_response_ms, 10) || null,
      avg_prompt_tokens_est: parseInt(row.avg_prompt_tokens_est, 10) || null,
    });
  } catch (err) {
    console.error('[API] cortex/stats failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/cortex/generate-report
 * 手动触发 Cortex 生成系统简报
 *
 * Body: { time_range_hours?: number (default: 48) }
 */
router.post('/cortex/generate-report', async (req, res) => {
  try {
    const { time_range_hours = 48 } = req.body || {};
    const timeRangeHours = Math.max(1, Math.min(168, Number(time_range_hours) || 48));

    const { generateSystemReport } = await import('../cortex.js');
    const report = await generateSystemReport({ timeRangeHours });

    res.json({ success: true, report });
  } catch (err) {
    console.error('[API] cortex/generate-report failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/cortex/reports
 * 获取最近的系统简报列表
 */
router.get('/cortex/reports', async (req, res) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    const result = await pool.query(`
      SELECT id, type, content, metadata, created_at
      FROM system_reports
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ success: true, reports: result.rows });
  } catch (err) {
    console.error('[API] cortex/reports failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/learning/evaluate-strategy
 * Evaluate strategy adjustment effectiveness
 *
 * Body: { strategy_key: string, days?: number }
 */
router.post('/learning/evaluate-strategy', async (req, res) => {
  try {
    const { strategy_key, days = 7 } = req.body;

    if (!strategy_key) {
      return res.status(400).json({ error: 'strategy_key required' });
    }

    const { evaluateStrategyEffectiveness } = await import('../learning.js');
    const result = await evaluateStrategyEffectiveness(strategy_key, days);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Failed to evaluate strategy:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==================== Growth Stats API ====================

/**
 * GET /api/brain/stats/overview
 * Cecelia 成长档案统计概览
 * 返回: birth_date, days_since_birth, tasks_completed, learnings_count
 */
router.get('/stats/overview', async (req, res) => {
  try {
    const BIRTH_DATE = '2026-02-28';
    const birthMs = new Date(BIRTH_DATE + 'T00:00:00+08:00').getTime();
    const nowMs = Date.now();
    const daysSinceBirth = Math.floor((nowMs - birthMs) / (1000 * 60 * 60 * 24)) + 1;

    const [tasksResult, learningsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS count FROM tasks WHERE status = 'completed'`),
      pool.query(`SELECT COUNT(*) AS count FROM learnings WHERE (archived = false OR archived IS NULL)`),
    ]);

    res.json({
      birth_date: BIRTH_DATE,
      days_since_birth: daysSinceBirth,
      tasks_completed: parseInt(tasksResult.rows[0]?.count || 0),
      learnings_count: parseInt(learningsResult.rows[0]?.count || 0),
    });
  } catch (err) {
    console.error('[API] Failed to get stats overview:', err.message);
    res.status(500).json({ error: 'Failed to get stats overview', details: err.message });
  }
});

// ==================== PR Stats API ====================

/**
 * GET /api/brain/stats/pr-count
 * 查询当月或指定月份自主完成的 PR 数量
 *
 * Query params:
 *   month  {number} 月份 (1-12)，默认当月
 *   year   {number} 年份，默认当年
 *   kr_id  {string} 可选，KR 的 UUID，过滤特定 KR 下的 PR
 */
router.get('/stats/pr-count', async (req, res) => {
  try {
    const now = new Date();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const kr_id = req.query.kr_id || null;

    if (month < 1 || month > 12 || isNaN(month)) {
      return res.status(400).json({ error: 'Invalid month parameter (must be 1-12)' });
    }
    if (year < 2020 || year > 2100 || isNaN(year)) {
      return res.status(400).json({ error: 'Invalid year parameter' });
    }

    let count;
    if (kr_id) {
      count = await getMonthlyPRsByKR(pool, kr_id, month, year);
    } else {
      count = await getMonthlyPRCount(pool, month, year);
    }

    const successRate = await getPRSuccessRate(pool, month, year);

    res.json({
      month,
      year,
      kr_id: kr_id || null,
      count,
      success_rate: successRate,
    });
  } catch (err) {
    console.error('[API] stats/pr-count error:', err.message);
    res.status(500).json({ error: 'Failed to get PR count', details: err.message });
  }
});

/**
 * GET /api/brain/stats/pr-trend
 * 获取最近 N 天每日 PR 完成趋势
 *
 * Query params:
 *   days  {number} 天数 (1-365)，默认 30
 */
router.get('/stats/pr-trend', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;

    if (isNaN(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: 'Invalid days parameter (must be 1-365)' });
    }

    const trend = await getPRTrend(pool, days);

    res.json({
      days,
      trend,
      total: trend.reduce((sum, d) => sum + d.count, 0),
    });
  } catch (err) {
    console.error('[API] stats/pr-trend error:', err.message);
    res.status(500).json({ error: 'Failed to get PR trend', details: err.message });
  }
});

/**
 * GET /api/brain/stats/autonomous-prs
 * 当月自主 PR 计数统计（Dashboard 进度条专用）
 * Query params:
 *   month: YYYY-MM（可选，默认当月）
 * Returns: { completed_count, target, month, percentage }
 */
router.get('/stats/autonomous-prs', async (req, res) => {
  try {
    const { month } = req.query;

    // 解析月份（默认当月）
    let targetMonth;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      targetMonth = month;
    } else {
      const now = new Date();
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const [year, mon] = targetMonth.split('-').map(Number);

    // 复用 stats.js 的 getMonthlyPRCount
    const completedCount = await getMonthlyPRCount(pool, mon, year);
    const target = 50; // 月目标：50 个自主 PR
    const percentage = target > 0 ? Math.min(100, Math.round((completedCount / target) * 100)) : 0;

    res.json({
      completed_count: completedCount,
      target,
      month: targetMonth,
      percentage,
    });
  } catch (err) {
    console.error('[API] Failed to get autonomous-prs stats:', err.message);
    res.status(500).json({ error: 'Failed to get autonomous-prs stats', details: err.message });
  }
});

// ==================== Capabilities API ====================

/**
 * GET /api/brain/capabilities
 * List all capabilities with optional filters
 *
 * Query params:
 *   current_stage: number (optional, 1-4)
 *   owner: string (optional)
 */
router.get('/capabilities', async (req, res) => {
  try {
    const { current_stage, owner, scope } = req.query;

    let query = 'SELECT * FROM capabilities WHERE 1=1';
    const params = [];

    if (current_stage) {
      params.push(parseInt(current_stage, 10));
      query += ` AND current_stage = $${params.length}`;
    }

    if (owner) {
      params.push(owner);
      query += ` AND owner = $${params.length}`;
    }

    if (scope) {
      params.push(scope);
      query += ` AND scope = $${params.length}`;
    }

    query += ' ORDER BY id ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      capabilities: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('[API] Failed to list capabilities:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to list capabilities',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/capabilities/:id
 * Get a single capability by ID
 */
router.get('/capabilities/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM capabilities WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Capability not found',
        code: 'CAPABILITY_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      capability: result.rows[0]
    });
  } catch (err) {
    console.error('[API] Failed to get capability:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get capability',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/capabilities
 * Create a new capability (from approved capability_proposal)
 *
 * Body: {
 *   id: string (required, slug format: autonomous-task-scheduling),
 *   name: string (required),
 *   description: string (optional),
 *   current_stage: number (optional, default 1),
 *   stage_definitions: object (optional),
 *   related_repos: string[] (optional),
 *   related_skills: string[] (optional),
 *   key_tables: string[] (optional),
 *   evidence: string (optional),
 *   owner: string (optional, default 'system')
 * }
 */
router.post('/capabilities', async (req, res) => {
  try {
    const {
      id,
      name,
      description,
      current_stage = 1,
      stage_definitions,
      related_repos,
      related_skills,
      key_tables,
      evidence,
      owner = 'system'
    } = req.body;

    // Validate required fields
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: id',
        code: 'MISSING_FIELD'
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: name',
        code: 'MISSING_FIELD'
      });
    }

    // Validate id format (slug: lowercase, hyphens, alphanumeric)
    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid id format. Use lowercase alphanumeric with hyphens (e.g., autonomous-task-scheduling)',
        code: 'INVALID_ID_FORMAT'
      });
    }

    // Validate current_stage range
    if (current_stage < 1 || current_stage > 4) {
      return res.status(400).json({
        success: false,
        error: 'current_stage must be between 1 and 4',
        code: 'INVALID_STAGE'
      });
    }

    // Check for duplicate ID
    const existingCheck = await pool.query(
      'SELECT id FROM capabilities WHERE id = $1',
      [id]
    );
    if (existingCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Capability with this ID already exists',
        code: 'DUPLICATE_ID'
      });
    }

    // Insert capability
    const result = await pool.query(
      `INSERT INTO capabilities (
        id, name, description, current_stage, stage_definitions,
        related_repos, related_skills, key_tables, evidence, owner
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id,
        name,
        description || null,
        current_stage,
        stage_definitions ? JSON.stringify(stage_definitions) : null,
        related_repos || null,
        related_skills || null,
        key_tables || null,
        evidence || null,
        owner
      ]
    );

    res.status(201).json({
      success: true,
      capability: result.rows[0]
    });
  } catch (err) {
    console.error('[API] Failed to create capability:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create capability',
      details: err.message
    });
  }
});

/**
 * PATCH /api/brain/capabilities/:id
 * Update a capability (typically for stage progression)
 *
 * Body: {
 *   current_stage: number (optional, 1-4),
 *   evidence: string (optional),
 *   description: string (optional),
 *   stage_definitions: object (optional),
 *   related_repos: string[] (optional),
 *   related_skills: string[] (optional),
 *   key_tables: string[] (optional)
 * }
 */
router.patch('/capabilities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      current_stage,
      evidence,
      description,
      stage_definitions,
      related_repos,
      related_skills,
      key_tables
    } = req.body;

    // Check capability exists
    const existingCheck = await pool.query(
      'SELECT * FROM capabilities WHERE id = $1',
      [id]
    );
    if (existingCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Capability not found',
        code: 'CAPABILITY_NOT_FOUND'
      });
    }

    // Validate current_stage if provided
    if (current_stage !== undefined && (current_stage < 1 || current_stage > 4)) {
      return res.status(400).json({
        success: false,
        error: 'current_stage must be between 1 and 4',
        code: 'INVALID_STAGE'
      });
    }

    // Build dynamic UPDATE query
    const updates = [];
    const params = [id];

    if (current_stage !== undefined) {
      params.push(current_stage);
      updates.push(`current_stage = $${params.length}`);
    }

    if (evidence !== undefined) {
      params.push(evidence);
      updates.push(`evidence = $${params.length}`);
    }

    if (description !== undefined) {
      params.push(description);
      updates.push(`description = $${params.length}`);
    }

    if (stage_definitions !== undefined) {
      params.push(JSON.stringify(stage_definitions));
      updates.push(`stage_definitions = $${params.length}`);
    }

    if (related_repos !== undefined) {
      params.push(related_repos);
      updates.push(`related_repos = $${params.length}`);
    }

    if (related_skills !== undefined) {
      params.push(related_skills);
      updates.push(`related_skills = $${params.length}`);
    }

    if (key_tables !== undefined) {
      params.push(key_tables);
      updates.push(`key_tables = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
        code: 'NO_UPDATES'
      });
    }

    // Always update updated_at
    updates.push('updated_at = NOW()');

    const query = `
      UPDATE capabilities
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      capability: result.rows[0]
    });
  } catch (err) {
    console.error('[API] Failed to update capability:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update capability',
      details: err.message
    });
  }
});

// ==================== PR Plans API (Layer 2) ====================

/**
 * POST /api/brain/pr-plans
 * Create a new PR Plan
 *
 * Body: {
 *   project_id: string (required),
 *   title: string (required),
 *   description: string (optional),
 *   dod: string (required),
 *   files: string[] (optional),
 *   sequence: number (optional, default 0),
 *   depends_on: string[] (optional),
 *   complexity: 'small'|'medium'|'large' (optional, default 'medium'),
 *   estimated_hours: number (optional)
 * }
 */
router.post('/pr-plans', async (req, res) => {
  try {
    const {
      project_id,
      title,
      description,
      dod,
      files,
      sequence = 0,
      depends_on,
      complexity = 'medium',
      estimated_hours
    } = req.body;

    // Validate required fields
    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: project_id',
        code: 'MISSING_FIELD'
      });
    }

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: title',
        code: 'MISSING_FIELD'
      });
    }

    if (!dod) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: dod',
        code: 'MISSING_FIELD'
      });
    }

    // Validate project exists（迁移：projects → okr_projects UNION okr_scopes UNION okr_initiatives）
    const projectCheck = await pool.query(
      `SELECT id FROM okr_projects WHERE id = $1
       UNION ALL SELECT id FROM okr_scopes WHERE id = $1
       UNION ALL SELECT id FROM okr_initiatives WHERE id = $1
       LIMIT 1`,
      [project_id]
    );
    if (projectCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }

    // Validate complexity
    const validComplexities = ['small', 'medium', 'large'];
    if (complexity && !validComplexities.includes(complexity)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid complexity value',
        code: 'INVALID_COMPLEXITY',
        allowed: validComplexities
      });
    }

    // Insert PR Plan
    const result = await pool.query(
      `INSERT INTO pr_plans (
        project_id, title, description, dod,
        files, sequence, depends_on, complexity, estimated_hours
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, project_id, title, description, dod,
                files, sequence, depends_on, complexity, estimated_hours,
                status, created_at, updated_at`,
      [
        project_id,
        title,
        description || null,
        dod,
        files || null,
        sequence,
        depends_on || null,
        complexity,
        estimated_hours || null
      ]
    );

    res.status(201).json({
      success: true,
      pr_plan: result.rows[0]
    });
  } catch (err) {
    console.error('[API] Failed to create PR Plan:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create PR Plan',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/pr-plans
 * Query PR Plans with optional filters
 *
 * Query params:
 *   project_id: string (optional)
 *   status: string (optional)
 */
router.get('/pr-plans', async (req, res) => {
  try {
    const { project_id, status } = req.query;

    let query = 'SELECT * FROM pr_plans WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (project_id) {
      query += ` AND project_id = $${paramIndex}`;
      params.push(project_id);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY sequence ASC, created_at ASC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      pr_plans: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('[API] Failed to query PR Plans:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to query PR Plans',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/pr-plans/:id
 * Get a single PR Plan with full context
 */
router.get('/pr-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM pr_plan_full_context WHERE pr_plan_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'PR Plan not found',
        code: 'PR_PLAN_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      pr_plan: result.rows[0]
    });
  } catch (err) {
    console.error('[API] Failed to get PR Plan:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get PR Plan',
      details: err.message
    });
  }
});

/**
 * PATCH /api/brain/pr-plans/:id
 * Update a PR Plan
 *
 * Body: {
 *   title: string (optional),
 *   description: string (optional),
 *   dod: string (optional),
 *   files: string[] (optional),
 *   sequence: number (optional),
 *   depends_on: string[] (optional),
 *   complexity: string (optional),
 *   estimated_hours: number (optional),
 *   status: string (optional)
 * }
 */
router.patch('/pr-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      dod,
      files,
      sequence,
      depends_on,
      complexity,
      estimated_hours,
      status
    } = req.body;

    // Check if PR Plan exists
    const checkResult = await pool.query(
      'SELECT id FROM pr_plans WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'PR Plan not found',
        code: 'PR_PLAN_NOT_FOUND'
      });
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ['planning', 'in_progress', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status value',
          code: 'INVALID_STATUS',
          allowed: validStatuses
        });
      }
    }

    // Validate complexity if provided
    if (complexity) {
      const validComplexities = ['small', 'medium', 'large'];
      if (!validComplexities.includes(complexity)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid complexity value',
          code: 'INVALID_COMPLEXITY',
          allowed: validComplexities
        });
      }
    }

    // Build update query dynamically
    const updates = [];
    const params = [id];
    let paramIndex = 2;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      params.push(title);
      paramIndex++;
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      params.push(description);
      paramIndex++;
    }

    if (dod !== undefined) {
      updates.push(`dod = $${paramIndex}`);
      params.push(dod);
      paramIndex++;
    }

    if (files !== undefined) {
      updates.push(`files = $${paramIndex}`);
      params.push(files);
      paramIndex++;
    }

    if (sequence !== undefined) {
      updates.push(`sequence = $${paramIndex}`);
      params.push(sequence);
      paramIndex++;
    }

    if (depends_on !== undefined) {
      updates.push(`depends_on = $${paramIndex}`);
      params.push(depends_on);
      paramIndex++;
    }

    if (complexity !== undefined) {
      updates.push(`complexity = $${paramIndex}`);
      params.push(complexity);
      paramIndex++;
    }

    if (estimated_hours !== undefined) {
      updates.push(`estimated_hours = $${paramIndex}`);
      params.push(estimated_hours);
      paramIndex++;
    }

    if (status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update',
        code: 'NO_UPDATES'
      });
    }

    updates.push(`updated_at = NOW()`);

    const updateQuery = `
      UPDATE pr_plans
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query(updateQuery, params);

    res.json({
      success: true,
      pr_plan: result.rows[0]
    });
  } catch (err) {
    console.error('[API] Failed to update PR Plan:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update PR Plan',
      details: err.message
    });
  }
});

/**
 * DELETE /api/brain/pr-plans/:id
 * Delete a PR Plan
 */
router.delete('/pr-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM pr_plans WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'PR Plan not found',
        code: 'PR_PLAN_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'PR Plan deleted successfully',
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('[API] Failed to delete PR Plan:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete PR Plan',
      details: err.message
    });
  }
});

// ============================================================
// Monitoring Loop Status
// ============================================================

/**
 * GET /api/brain/monitor/status
 * Get monitoring loop status
 */
router.get('/monitor/status', async (req, res) => {
  try {
    const { getMonitorStatus } = await import('../monitor-loop.js');
    const status = getMonitorStatus();

    res.json({
      success: true,
      status: status
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get monitor status',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/probes/status - Capability probe system status
 */
router.get('/probes/status', async (req, res) => {
  try {
    const { getProbeStatus, getProbeResults } = await import('../capability-probe.js');
    const status = getProbeStatus();
    const recentResults = await getProbeResults(3);

    res.json({
      success: true,
      status,
      recent_results: recentResults,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get probe status',
      details: err.message,
    });
  }
});

/**
 * POST /api/brain/probes/run - Manually trigger probe cycle
 */
router.post('/probes/run', async (req, res) => {
  try {
    const { runProbeCycle } = await import('../capability-probe.js');
    const results = await runProbeCycle();

    res.json({
      success: true,
      results,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to run probes',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/capabilities/health - 能力健康地图
 */
router.get('/capabilities/health', async (req, res) => {
  try {
    const { getCapabilityHealth } = await import('../capability-scanner.js');
    const results = await getCapabilityHealth(1);

    res.json({
      success: true,
      health: results[0]?.payload || null,
      scanned_at: results[0]?.created_at || null,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get capability health',
      details: err.message,
    });
  }
});

/**
 * POST /api/brain/capabilities/scan - 手动触发能力扫描
 */
router.post('/capabilities/scan', async (req, res) => {
  try {
    const { runScanCycle } = await import('../capability-scanner.js');
    const result = await runScanCycle();

    res.json({
      success: true,
      result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to run capability scan',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/config/area-slots - 读取 Area Slot 配置
 */
router.get('/config/area-slots', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM brain_config WHERE key = 'area_slots'`
    );
    const config = rows.length > 0 ? JSON.parse(rows[0].value) : {};

    const { rows: taskRows } = await pool.query(`
      SELECT
        COALESCE(ar.domain, 'zenithjoy') as area,
        count(*) FILTER (WHERE t.status = 'in_progress') as running,
        count(*) FILTER (WHERE t.status = 'queued') as queued
      FROM tasks t
      LEFT JOIN key_results g ON t.goal_id = g.id
      LEFT JOIN areas ar ON g.area_id = ar.id
      WHERE t.status IN ('in_progress', 'queued')
      GROUP BY COALESCE(ar.domain, 'zenithjoy')
    `);
    const status = {};
    for (const r of taskRows) {
      status[r.area] = { running: parseInt(r.running), queued: parseInt(r.queued) };
    }

    res.json({ success: true, config, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/brain/config/area-slots - 保存 Area Slot 配置
 */
router.put('/config/area-slots', async (req, res) => {
  try {
    const config = req.body;
    await pool.query(
      `INSERT INTO brain_config (key, value) VALUES ('area_slots', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(config)]
    );
    res.json({ success: true, saved: config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// Attachment Decision API
// ============================================================

/**
 * POST /api/brain/search-similar
 * Search for similar entities (Tasks/Initiatives/KRs)
 *
 * Request body:
 * {
 *   query: string (required),
 *   top_k: number (optional, default 5),
 *   filters: {
 *     repo: string (optional) - filter by repository name,
 *     project_id: number (optional) - filter by project ID,
 *     date_from: string (optional) - filter by creation date (ISO format),
 *     date_to: string (optional) - filter by creation date (ISO format)
 *   }
 * }
 */
router.post('/search-similar', async (req, res) => {
  try {
    const { query, top_k = 5, filters = {} } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: query'
      });
    }

    // Validate filters if provided
    if (filters.repo && typeof filters.repo !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter: repo must be a string'
      });
    }

    if (filters.project_id && typeof filters.project_id !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Invalid filter: project_id must be a number'
      });
    }

    const { default: SimilarityService } = await import('../similarity.js');
    const similarityService = new SimilarityService();

    const result = await similarityService.searchSimilar(query, top_k, filters);

    res.json({
      success: true,
      filters_applied: filters,
      ...result
    });
  } catch (err) {
    console.error('[API] Failed to search similar entities:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to search similar entities',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/attach-decision
 * Make attachment decision for new task (LLM-based)
 */
router.post('/attach-decision', async (req, res) => {
  try {
    const { input, matches, context } = req.body;

    if (!input) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: input'
      });
    }

    // Rule-based attachment decision: check similarity scores to determine action

    // Short-circuit A: Check for duplicate tasks (score >= 0.85)
    const duplicateTasks = (matches || []).filter(m => m.level === 'task' && m.score >= 0.85);
    if (duplicateTasks.length > 0) {
      const target = duplicateTasks[0];
      return res.json({
        success: true,
        input,
        attach: {
          action: 'duplicate_task',
          target: {
            level: target.level,
            id: target.id,
            title: target.title
          },
          confidence: target.score,
          reason: `已存在高度相似的任务（相似度 ${Math.round(target.score * 100)}%）`,
          top_matches: duplicateTasks.slice(0, 3)
        },
        route: {
          path: 'direct_dev',
          why: ['任务已存在，可以参考或复用'],
          confidence: 0.9
        },
        next_call: {
          skill: '/dev',
          args: {
            reference_task_id: target.id
          }
        }
      });
    }

    // Short-circuit B: Check for related initiatives (score >= 0.65)
    const relatedInitiatives = (matches || []).filter(m => m.level === 'initiative' && m.score >= 0.65);
    if (relatedInitiatives.length > 0) {
      const target = relatedInitiatives[0];
      return res.json({
        success: true,
        input,
        attach: {
          action: 'extend_initiative',
          target: {
            level: target.level,
            id: target.id,
            title: target.title
          },
          confidence: target.score,
          reason: `属于现有 Initiative 的合理扩展（相似度 ${Math.round(target.score * 100)}%）`,
          top_matches: relatedInitiatives.slice(0, 3)
        },
        route: {
          path: 'extend_initiative_then_dev',
          why: ['在现有 Initiative 下扩展功能', '直接创建 dev 任务'],
          confidence: 0.75
        },
        next_call: {
          skill: '/dev',
          args: {
            initiative_id: target.id,
            task_description: input
          }
        }
      });
    }

    // Check for related KRs (score >= 0.60)
    const relatedKRs = (matches || []).filter(m => m.level === 'kr' && m.score >= 0.60);
    if (relatedKRs.length > 0) {
      const target = relatedKRs[0];
      return res.json({
        success: true,
        input,
        attach: {
          action: 'create_initiative_under_kr',
          target: {
            level: target.level,
            id: target.id,
            title: target.title
          },
          confidence: target.score,
          reason: `在现有 KR 下创建新 Initiative（相似度 ${Math.round(target.score * 100)}%）`,
          top_matches: relatedKRs.slice(0, 3)
        },
        route: {
          path: 'okr_then_dev',
          why: ['需要先创建 Initiative', '然后进行技术验证'],
          confidence: 0.7
        },
        next_call: {
          skill: '/okr',
          args: {
            kr_id: target.id,
            task_description: input
          }
        }
      });
    }

    // Default: Create new OKR/KR
    return res.json({
      success: true,
      input,
      attach: {
        action: 'create_new_okr_kr',
        target: {
          level: 'okr',
          id: null,
          title: null
        },
        confidence: 0.5,
        reason: '没有找到相关的 OKR/KR/Initiative，需要创建新的',
        top_matches: []
      },
      route: {
        path: 'okr_then_dev',
        why: ['需要完整规划（OKR → Initiative → PR Plans）', '然后进行开发'],
        confidence: 0.6
      },
      next_call: {
        skill: '/okr',
        args: {
          task_description: input
        }
      }
    });

  } catch (err) {
    console.error('[API] Failed to make attachment decision:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to make attachment decision',
      details: err.message
    });
  }
});

// ─── 内容效果数据采集 API ─────────────────────────────────────────────────────

/**
 * POST /api/brain/analytics/content
 * 写入内容效果采集快照（单条）。
 *
 * Body: { platform, contentId?, title?, publishedAt?, metrics: { views, likes, comments, shares, clicks }, source?, pipelineId?, rawData? }
 */
router.post('/analytics/content', async (req, res) => {
  try {
    const { platform, contentId, title, publishedAt, metrics, source, pipelineId, rawData } = req.body;
    if (!platform) {
      return res.status(400).json({ error: 'platform is required' });
    }
    const id = await writeContentAnalytics(pool, {
      platform, contentId, title, publishedAt, metrics, source, pipelineId, rawData,
    });
    res.status(201).json({ id });
  } catch (err) {
    console.error('[API] analytics/content POST 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/analytics/content/bulk
 * 批量写入内容效果采集快照。
 *
 * Body: { items: Array<{ platform, contentId?, title?, publishedAt?, metrics, source?, pipelineId?, rawData? }> }
 */
router.post('/analytics/content/bulk', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }
    const count = await bulkWriteContentAnalytics(pool, items);
    res.status(201).json({ written: count });
  } catch (err) {
    console.error('[API] analytics/content/bulk POST 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/analytics/content
 * 查询内容效果数据（最近 7 天，按平台分组热门）。
 *
 * Query params:
 * - platform: 筛选平台
 * - limit: 返回条数（默认 10）
 * - since: ISO 日期字符串（默认 7 天前）
 */
router.get('/analytics/content', async (req, res) => {
  try {
    const { platform, limit, since, days } = req.query;
    const sinceDate = since
      ? new Date(since)
      : days
      ? new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000)
      : undefined;
    const items = await getTopContentByPlatform(pool, {
      platform,
      since: sinceDate,
      limit: parseInt(limit) || 10,
    });
    res.json(items);
  } catch (err) {
    console.error('[API] analytics/content GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/analytics/roi
 * 查询指定时间范围内的内容 ROI（平台维度汇总）。
 *
 * Query params:
 * - start: ISO 日期（默认 7 天前）
 * - end: ISO 日期（默认当前时间）
 */
router.get('/analytics/roi', async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = end ? new Date(end) : new Date();
    const roi = await queryWeeklyROI(pool, startDate, endDate);
    res.json({ start: startDate.toISOString(), end: endDate.toISOString(), roi });
  } catch (err) {
    console.error('[API] analytics/roi GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 爬虫结果写回（N8N / platform_scrape.sh → Brain）──────────────────────────

/**
 * POST /api/brain/analytics/scrape-result
 * 接收平台爬虫采集结果，写入 content_analytics（ROI 计算）和
 * pipeline_publish_stats（话题热度评分）。
 *
 * Body:
 * {
 *   platform: string,                  // 平台名（必填）
 *   publishTaskId?: string,            // content_publish 任务 ID（带时则写 pipeline_publish_stats）
 *   pipelineId?: string,               // 上游 pipeline ID（可选）
 *   items: Array<{                     // 采集到的内容列表
 *     contentId?: string,
 *     title?: string,
 *     publishedAt?: string,
 *     views?: number,
 *     likes?: number,
 *     comments?: number,
 *     shares?: number,
 *     clicks?: number,
 *     rawData?: object,
 *   }>
 * }
 *
 * Returns: { written: number, platform: string, totals: { views, likes, comments, shares } }
 */
router.post('/analytics/scrape-result', async (req, res) => {
  try {
    const { platform, publishTaskId, pipelineId, items } = req.body;
    if (!platform) {
      return res.status(400).json({ error: 'platform is required' });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }

    // 1. 写入 content_analytics（每条内容单独记录，供 ROI 计算）
    const analyticsItems = items.map(item => ({
      platform,
      contentId: item.contentId,
      title: item.title,
      publishedAt: item.publishedAt,
      metrics: {
        views: item.views || 0,
        likes: item.likes || 0,
        comments: item.comments || 0,
        shares: item.shares || 0,
        clicks: item.clicks || 0,
      },
      source: 'scraper',
      pipelineId: pipelineId || null,
      rawData: item.rawData || {},
    }));
    const written = await bulkWriteContentAnalytics(pool, analyticsItems);

    // 2. 聚合指标写入 pipeline_publish_stats（供话题热度评分）
    let totals = { views: 0, likes: 0, comments: 0, shares: 0 };
    if (publishTaskId && items.length > 0) {
      totals = items.reduce(
        (acc, item) => ({
          views: acc.views + (item.views || 0),
          likes: acc.likes + (item.likes || 0),
          comments: acc.comments + (item.comments || 0),
          shares: acc.shares + (item.shares || 0),
        }),
        { views: 0, likes: 0, comments: 0, shares: 0 }
      );
      await upsertPipelinePublishStats(pool, {
        publishTaskId,
        pipelineId: pipelineId || null,
        platform,
        metrics: totals,
      });
    }

    res.status(201).json({ written, platform, totals });
  } catch (err) {
    console.error('[API] analytics/scrape-result POST 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/analytics/platform-summary
 * 按平台聚合内容效果数据（供 Dashboard 和周报使用）。
 *
 * Query params:
 * - days: 统计天数（默认 7）
 * - platform: 筛选特定平台（可选）
 */
router.get('/analytics/platform-summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const platform = req.query.platform;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params = [since];
    const platformClause = platform ? `AND platform = $2` : '';
    if (platform) params.push(platform);

    const { rows } = await pool.query(
      `SELECT
         platform,
         COUNT(*)::int                                    AS content_count,
         COALESCE(SUM(views), 0)::bigint                 AS total_views,
         COALESCE(SUM(likes), 0)::bigint                 AS total_likes,
         COALESCE(SUM(comments), 0)::bigint              AS total_comments,
         COALESCE(SUM(shares), 0)::bigint                AS total_shares,
         CASE WHEN COUNT(*) > 0
           THEN ROUND(COALESCE(SUM(views), 0)::numeric / COUNT(*), 0)
           ELSE 0
         END                                             AS avg_views,
         CASE WHEN COALESCE(SUM(views), 0) > 0
           THEN ROUND(
             (COALESCE(SUM(likes), 0) + COALESCE(SUM(comments), 0) + COALESCE(SUM(shares), 0))::numeric
             / COALESCE(SUM(views), 0) * 1000, 2
           )
           ELSE 0
         END                                             AS engagement_rate,
         MAX(collected_at)                               AS last_collected_at
       FROM content_analytics
       WHERE collected_at >= $1
         ${platformClause}
       GROUP BY platform
       ORDER BY total_views DESC`,
      params
    );

    res.json({
      since: since.toISOString(),
      days,
      platforms: rows.map(r => ({
        platform: r.platform,
        content_count: Number(r.content_count),
        total_views: Number(r.total_views),
        total_likes: Number(r.total_likes),
        total_comments: Number(r.total_comments),
        total_shares: Number(r.total_shares),
        avg_views: Number(r.avg_views),
        engagement_rate: Number(r.engagement_rate),
        last_collected_at: r.last_collected_at,
      })),
    });
  } catch (err) {
    console.error('[API] analytics/platform-summary GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 采集覆盖状态 ─────────────────────────────────────────────────────────────

/**
 * GET /api/brain/analytics/collection-coverage
 * 查询各平台在 content_analytics 中的数据覆盖状态。
 *
 * 返回 8 个已知平台的数据条数、最后采集时间、是否新鲜（7天内）。
 * 供选题引擎感知哪些平台数据缺失，自动触发补采。
 */
router.get('/analytics/collection-coverage', async (req, res) => {
  try {
    const coverage = await getCollectionCoverage(pool);
    const missing = coverage.filter(p => !p.has_data).map(p => p.platform);
    const stale   = coverage.filter(p => p.has_data && !p.is_fresh).map(p => p.platform);

    res.json({
      platforms: coverage,
      summary: {
        total:   coverage.length,
        has_data: coverage.filter(p => p.has_data).length,
        missing,
        stale,
        coverage_pct: coverage.length > 0
          ? Math.round(coverage.filter(p => p.has_data).length / coverage.length * 100)
          : 0,
      },
    });
  } catch (err) {
    console.error('[API] analytics/collection-coverage GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/analytics/social-media-sync
 * 手动触发从 social_media_raw 到 content_analytics 的数据同步。
 *
 * 无需 body。返回同步结果: { synced, skipped, source_count }
 */
router.post('/analytics/social-media-sync', async (req, res) => {
  try {
    const result = await syncSocialMediaData(pool);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] analytics/social-media-sync POST 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 数据管道健康状态 ──────────────────────────────────────────────────────────

/**
 * GET /api/brain/analytics/pipeline-status
 * 返回全平台数据采集管道的健康状态。
 *
 * 供 Dashboard、选题引擎、日报感知哪些平台数据新鲜、哪些缺失。
 *
 * Returns:
 * {
 *   overall_health: 'healthy' | 'stale' | 'empty',
 *   content_analytics_total: number,
 *   platforms: [{ platform, content_count, last_collected_at, is_fresh, has_data }],
 *   missing_platforms: string[],
 *   stale_platforms: string[],
 *   coverage_pct: number,
 *   checked_at: string (ISO)
 * }
 */
router.get('/analytics/pipeline-status', async (req, res) => {
  try {
    const [coverage, totalResult] = await Promise.all([
      getCollectionCoverage(pool),
      pool.query('SELECT COUNT(*)::int AS total FROM content_analytics'),
    ]);

    const total         = totalResult.rows[0]?.total || 0;
    const missingPlats  = coverage.filter(p => !p.has_data).map(p => p.platform);
    const stalePlats    = coverage.filter(p => p.has_data && !p.is_fresh).map(p => p.platform);
    const coveragePct   = coverage.length > 0
      ? Math.round(coverage.filter(p => p.has_data).length / coverage.length * 100)
      : 0;

    let overallHealth;
    if (total === 0) {
      overallHealth = 'empty';
    } else if (stalePlats.length >= Math.ceil(coverage.length / 2)) {
      overallHealth = 'stale';
    } else {
      overallHealth = 'healthy';
    }

    res.json({
      overall_health:           overallHealth,
      content_analytics_total:  total,
      platforms:                coverage,
      missing_platforms:        missingPlats,
      stale_platforms:          stalePlats,
      coverage_pct:             coveragePct,
      checked_at:               new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] analytics/pipeline-status GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 每日平台采集手动触发 ──────────────────────────────────────────────────────

/**
 * POST /api/brain/analytics/trigger-platform-scrape
 * 立即为所有平台创建 platform_scraper 任务（跳过时间窗口检查）。
 * 用于初始数据填充和手动补采。
 *
 * Returns: { created: number, skipped: number }
 */
router.post('/analytics/trigger-platform-scrape', async (req, res) => {
  try {
    const { scheduled, skipped } = await scheduleDailyScrape(pool, { force: true });
    res.status(201).json({ created: scheduled, skipped });
  } catch (err) {
    console.error('[API] analytics/trigger-platform-scrape POST 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 算力消耗快照 ──────────────────────────────────────────────────────────────

/**
 * POST /api/brain/analytics/compute-snapshot
 * 立即将当前账号用量快照写入 llm_usage_snapshots。
 * tick 每日调用一次；也支持手动触发。
 *
 * Returns: { saved: number }
 */
router.post('/analytics/compute-snapshot', async (req, res) => {
  try {
    const usage = await getAccountUsage(true);
    const accounts = Object.values(usage);
    let saved = 0;
    for (const acc of accounts) {
      await pool.query(
        `INSERT INTO llm_usage_snapshots
           (account_id, five_hour_pct, seven_day_pct, seven_day_sonnet_pct, is_spending_capped, recorded_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          acc.account_id,
          acc.five_hour_pct || 0,
          acc.seven_day_pct || 0,
          acc.seven_day_sonnet_pct || 0,
          acc.is_spending_capped || false,
        ]
      );
      saved++;
    }
    res.json({ saved });
  } catch (err) {
    console.error('[API] analytics/compute-snapshot POST 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/analytics/compute-usage
 * 查询最近 N 天的算力消耗历史快照。
 *
 * Query params:
 * - days: 统计天数（默认 7）
 * - account_id: 筛选特定账号（可选）
 *
 * Returns: { snapshots: Array, summary: { avg_five_hour_pct, avg_seven_day_pct } }
 */
router.get('/analytics/compute-usage', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const accountId = req.query.account_id;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const params = [since];
    const accountClause = accountId ? `AND account_id = $2` : '';
    if (accountId) params.push(accountId);

    const { rows } = await pool.query(
      `SELECT
         account_id,
         ROUND(AVG(five_hour_pct)::numeric, 1)         AS avg_five_hour_pct,
         ROUND(AVG(seven_day_pct)::numeric, 1)         AS avg_seven_day_pct,
         ROUND(AVG(seven_day_sonnet_pct)::numeric, 1)  AS avg_sonnet_pct,
         ROUND(MAX(five_hour_pct)::numeric, 1)         AS peak_five_hour_pct,
         COUNT(*)::int                                  AS snapshot_count,
         MIN(recorded_at)                               AS first_recorded_at,
         MAX(recorded_at)                               AS last_recorded_at
       FROM llm_usage_snapshots
       WHERE recorded_at >= $1
         ${accountClause}
       GROUP BY account_id
       ORDER BY account_id`,
      params
    );

    const snapshots = rows.map(r => ({
      account_id: r.account_id,
      avg_five_hour_pct: Number(r.avg_five_hour_pct),
      avg_seven_day_pct: Number(r.avg_seven_day_pct),
      avg_sonnet_pct: Number(r.avg_sonnet_pct),
      peak_five_hour_pct: Number(r.peak_five_hour_pct),
      snapshot_count: Number(r.snapshot_count),
      first_recorded_at: r.first_recorded_at,
      last_recorded_at: r.last_recorded_at,
    }));

    res.json({ since: since.toISOString(), days, snapshots });
  } catch (err) {
    console.error('[API] analytics/compute-usage GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 采集仪表盘 ────────────────────────────────────────────────────────────────

/**
 * GET /api/brain/analytics/collection-dashboard
 * 采集仪表盘：各平台每日数据量 + 采集任务失败率 + 平均延迟 + 全平台正常率。
 *
 * Query params:
 * - days: 统计天数（默认 7）
 *
 * Returns:
 * {
 *   generated_at, days, normality_rate,
 *   platforms: [{ platform, daily_counts, total_count, failure_rate, avg_latency_min, last_collected_at, is_healthy }],
 *   summary: { total_data_points, platforms_with_data, platforms_missing, healthy_platform_count }
 * }
 */
router.get('/analytics/collection-dashboard', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. 每日数据量：按平台 + 日期聚合
    const { rows: dailyRows } = await pool.query(
      `SELECT
         platform,
         DATE(collected_at AT TIME ZONE 'Asia/Shanghai')::text AS day,
         COUNT(*)::int AS count
       FROM content_analytics
       WHERE collected_at >= $1
       GROUP BY platform, day
       ORDER BY platform, day`,
      [since]
    );

    // 2. platform_scraper 任务统计：成功/失败数量 + 平均延迟
    const { rows: taskRows } = await pool.query(
      `SELECT
         payload->>'platform'                                   AS platform,
         COUNT(*)::int                                          AS total_tasks,
         COUNT(*) FILTER (WHERE status = 'failed')::int        AS failed_tasks,
         COUNT(*) FILTER (WHERE status = 'completed')::int     AS completed_tasks,
         ROUND(
           AVG(
             EXTRACT(EPOCH FROM (completed_at - created_at)) / 60
           ) FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL),
           1
         )                                                      AS avg_latency_min
       FROM tasks
       WHERE task_type = 'platform_scraper'
         AND created_at >= $1
         AND payload->>'platform' IS NOT NULL
       GROUP BY payload->>'platform'`,
      [since]
    );

    // 3. 最后采集时间（从 content_analytics）
    const { rows: lastRows } = await pool.query(
      `SELECT platform, MAX(collected_at) AS last_collected_at
       FROM content_analytics
       WHERE collected_at >= $1
       GROUP BY platform`,
      [since]
    );
    const lastMap = new Map(lastRows.map(r => [r.platform, r.last_collected_at]));

    // 整合数据
    const KNOWN_PLATFORMS_DASH = [
      'douyin', 'kuaishou', 'xiaohongshu', 'toutiao', 'toutiao-2',
      'weibo', 'channels', 'gongzhonghao',
    ];

    // 构建日期序列（最近 days 天，精确到日）
    const dateLabels = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const tz = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      const label = `${tz.getFullYear()}-${String(tz.getMonth() + 1).padStart(2, '0')}-${String(tz.getDate()).padStart(2, '0')}`;
      dateLabels.push(label);
    }

    // 建立 dailyMap: platform → { date → count }
    const dailyMap = new Map();
    for (const r of dailyRows) {
      if (!dailyMap.has(r.platform)) dailyMap.set(r.platform, new Map());
      dailyMap.get(r.platform).set(r.day, r.count);
    }

    // 建立 taskMap: platform → stats
    const taskMap = new Map(taskRows.map(r => [r.platform, r]));

    // 合并所有出现过的平台（已知 + 实际有数据的）
    const allPlatforms = new Set([
      ...KNOWN_PLATFORMS_DASH,
      ...dailyMap.keys(),
      ...taskMap.keys(),
    ]);

    // 计算每日正常（有数据）的 platform-day 数量
    let totalPlatformDays = 0;
    let normalPlatformDays = 0;

    const platforms = [];
    for (const platform of allPlatforms) {
      const dayMap = dailyMap.get(platform) || new Map();
      const stats = taskMap.get(platform);

      const daily_counts = dateLabels.map(date => ({
        date,
        count: dayMap.get(date) || 0,
      }));

      const total_count = daily_counts.reduce((s, d) => s + d.count, 0);

      // 正常率计算：有数据的天 / 总天数
      totalPlatformDays += days;
      normalPlatformDays += daily_counts.filter(d => d.count > 0).length;

      const total_tasks = stats ? Number(stats.total_tasks) : 0;
      const failed_tasks = stats ? Number(stats.failed_tasks) : 0;
      const failure_rate = total_tasks > 0
        ? Math.round((failed_tasks / total_tasks) * 1000) / 10
        : null;
      const avg_latency_min = stats?.avg_latency_min != null
        ? Number(stats.avg_latency_min)
        : null;

      const last_collected_at = lastMap.get(platform) || null;
      const is_healthy = total_count > 0 && (failure_rate === null || failure_rate < 50);

      platforms.push({
        platform,
        daily_counts,
        total_count,
        failure_rate,
        avg_latency_min,
        last_collected_at,
        is_healthy,
      });
    }

    platforms.sort((a, b) => b.total_count - a.total_count);

    const normality_rate = totalPlatformDays > 0
      ? Math.round((normalPlatformDays / totalPlatformDays) * 1000) / 10
      : 0;

    const platforms_with_data = platforms.filter(p => p.total_count > 0).map(p => p.platform);
    const platforms_missing = KNOWN_PLATFORMS_DASH.filter(p => !platforms_with_data.includes(p));

    res.json({
      generated_at: new Date().toISOString(),
      days,
      normality_rate,
      platforms,
      summary: {
        total_data_points: platforms.reduce((s, p) => s + p.total_count, 0),
        platforms_with_data: platforms_with_data.length,
        platforms_missing,
        healthy_platform_count: platforms.filter(p => p.is_healthy).length,
      },
    });
  } catch (err) {
    console.error('[API] analytics/collection-dashboard GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 采集仪表盘统计 ────────────────────────────────────────────────────────────

/**
 * GET /api/brain/analytics/collection-stats
 * 采集仪表盘：各平台每日数据量、scraper 任务成功率、整体健康率。
 *
 * Query params:
 *   - days: 回溯天数（默认 7，最大 30）
 *
 * Returns:
 *   {
 *     health: { overall_inflow_rate, target_rate, healthy },
 *     platforms: [{ platform, daily_volumes, scraper_stats, last_collected_at, is_fresh }],
 *     synced_at: ISO string
 *   }
 */
router.get('/analytics/collection-stats', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1. 各平台每日数据量（content_analytics）
    const { rows: volumeRows } = await pool.query(
      `SELECT
         platform,
         DATE(collected_at AT TIME ZONE 'UTC') AS date,
         COUNT(*)::int                          AS count
       FROM content_analytics
       WHERE collected_at >= $1
       GROUP BY platform, DATE(collected_at AT TIME ZONE 'UTC')
       ORDER BY platform, date`,
      [since.toISOString()]
    );

    // 2. platform_scraper 任务成功率（tasks 表，忽略不存在的 task_type）
    let scraperRows = [];
    try {
      const { rows } = await pool.query(
        `SELECT
           payload->>'platform'  AS platform,
           status,
           COUNT(*)::int          AS cnt
         FROM tasks
         WHERE task_type = 'platform_scraper'
           AND created_at >= $1
         GROUP BY payload->>'platform', status`,
        [since.toISOString()]
      );
      scraperRows = rows;
    } catch (_) {
      // platform_scraper 类型不存在时静默忽略
    }

    // 3. 各平台最后采集时间
    const { rows: coverageRows } = await pool.query(
      `SELECT
         platform,
         COUNT(*)::int  AS total_records,
         MAX(collected_at) AS last_collected_at
       FROM content_analytics
       GROUP BY platform`
    );

    // 整理 scraper stats per platform
    const scraperMap = {};
    for (const r of scraperRows) {
      if (!r.platform) continue;
      if (!scraperMap[r.platform]) {
        scraperMap[r.platform] = { total: 0, completed: 0, failed: 0 };
      }
      scraperMap[r.platform].total += r.cnt;
      if (r.status === 'completed') scraperMap[r.platform].completed += r.cnt;
      if (r.status === 'failed') scraperMap[r.platform].failed += r.cnt;
    }

    // 整理 coverage per platform
    const coverageMap = {};
    for (const r of coverageRows) {
      coverageMap[r.platform] = {
        total_records: r.total_records,
        last_collected_at: r.last_collected_at,
      };
    }

    // 整理 daily volumes per platform
    const volumeMap = {};
    for (const r of volumeRows) {
      if (!volumeMap[r.platform]) volumeMap[r.platform] = [];
      volumeMap[r.platform].push({ date: r.date, count: r.count });
    }

    // 所有出现过的平台（已知 + DB 实际）
    const { KNOWN_PLATFORMS } = await import('../social-media-sync.js');
    const allPlatforms = new Set([...KNOWN_PLATFORMS, ...Object.keys(volumeMap), ...Object.keys(coverageMap)]);

    // 生成返回结构
    const freshCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const platforms = [...allPlatforms].sort().map(platform => {
      const cov = coverageMap[platform] || {};
      const scraper = scraperMap[platform] || { total: 0, completed: 0, failed: 0 };
      const lastAt = cov.last_collected_at ? new Date(cov.last_collected_at) : null;
      const isFresh = lastAt ? lastAt > freshCutoff : false;
      const successRate = scraper.total > 0
        ? Math.round((scraper.completed / scraper.total) * 100)
        : null;

      return {
        platform,
        daily_volumes: volumeMap[platform] || [],
        last_collected_at: cov.last_collected_at || null,
        is_fresh: isFresh,
        has_data: Boolean(cov.total_records > 0),
        total_records: cov.total_records || 0,
        scraper_stats: {
          total: scraper.total,
          completed: scraper.completed,
          failed: scraper.failed,
          success_rate: successRate,
        },
      };
    });

    // 整体健康率：过去 N 天内，有数据的平台占比
    const activeDays = days;
    const platformsWithData = platforms.filter(p => p.has_data).length;
    const overallInflowRate = platforms.length > 0
      ? Math.round((platformsWithData / platforms.length) * 100)
      : 0;
    const TARGET_RATE = 95;

    res.json({
      health: {
        overall_inflow_rate: overallInflowRate,
        target_rate: TARGET_RATE,
        healthy: overallInflowRate >= TARGET_RATE,
        platforms_with_data: platformsWithData,
        total_platforms: platforms.length,
      },
      platforms,
      query_days: activeDays,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] analytics/collection-stats GET 失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
