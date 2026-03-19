import { Router } from 'express';
import pool from '../db.js';
import { getMonthlyPRCount, getMonthlyPRsByKR, getPRSuccessRate, getPRTrend } from '../stats.js';
import { searchRelevantAnalyses } from '../cortex.js';
import {
  evaluateQualityInitial,
  checkShouldCreateRCA,
  getQualityStats,
} from '../cortex-quality.js';
import { runDecompositionChecks } from '../decomposition-checker.js';
import { getActiveExecutionPaths, INVENTORY_CONFIG } from './shared.js';

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

    // Validate project exists
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1',
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

export default router;
