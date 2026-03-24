import express, { Router } from 'express';
import pool from '../db.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, readdirSync } from 'fs';
import { createTask, updateTask } from '../actions.js';
import { callLLM, callLLMStream } from '../llm-caller.js';
import { handleChat } from '../orchestrator-chat.js';
import { check48hReport } from '../tick.js';
import { getTaskWeights } from '../task-weight.js';
import { getCleanupStats, runTaskCleanup, getCleanupAuditLog } from '../task-cleanup.js';
import { getDispatchStats } from '../dispatch-stats.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from '../thalamus.js';
import { executeDecision as executeThalamusDecision } from '../decision-executor.js';
import { ASYNC_CALLBACK_TYPES } from '../task-router.js';
import {
  createSuggestion,
  executeTriage,
  getTopPrioritySuggestions,
  updateSuggestionStatus,
  cleanupExpiredSuggestions,
  getTriageStats
} from '../suggestion-triage.js';
import {
  runDecompositionChecks,
} from '../decomposition-checker.js';
import { verifyWebhookSignature, extractPrInfo, handlePrMerged } from '../pr-callback-handler.js';
import { resolveRelatedFailureMemories, getActiveExecutionPaths, INVENTORY_CONFIG } from './shared.js';

const router = Router();
const execAsync = promisify(exec);


// ============================================================
// Desire System API — Cecelia 的欲望/表达
// ============================================================

/**
 * GET /api/brain/desires
 * 列出 desires，支持按 type/status 筛选
 * Query: type, status, limit(default 50)
 */
router.get('/desires', async (req, res) => {
  try {
    const { type, status = 'pending', limit = 50 } = req.query;
    const conditions = [];
    const params = [];

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    if (status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    params.push(Math.min(parseInt(limit) || 50, 200));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT id, type, content, insight, proposed_action,
             urgency, evidence, status, created_at, expires_at
      FROM desires
      ${where}
      ORDER BY urgency DESC, created_at DESC
      LIMIT $${params.length}
    `, params);

    res.json({ desires: rows, total: rows.length });
  } catch (err) {
    console.error('[API] desires error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/desires/stats
 * 各状态/类型数量，用于前端 badge
 */
router.get('/desires/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'pending' AND type IN ('propose','question')) AS pending_decisions,
        COUNT(*) FILTER (WHERE status = 'pending' AND type IN ('warn')) AS pending_warns,
        COUNT(*) FILTER (WHERE status = 'pending' AND type IN ('inform','celebrate')) AS pending_updates,
        COUNT(*) AS total
      FROM desires
      WHERE expires_at IS NULL OR expires_at > NOW()
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error('[API] desires/stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/desires/:id
 * 更新 desire 状态（read / dismissed / expressed）
 * Body: { status: 'expressed' | 'suppressed' }
 */
router.patch('/desires/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const ALLOWED = ['expressed', 'suppressed', 'acknowledged'];
    if (!ALLOWED.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE desires SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'desire not found' });

    // 广播 WebSocket 事件
    const { publishDesireUpdated } = await import('../events/taskEvents.js');
    publishDesireUpdated({ id, status, previous_status: 'pending' });

    res.json({ success: true, desire: rows[0] });
  } catch (err) {
    console.error('[API] desires/:id patch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/desires/:id/respond
 * 用户对 desire 回复意见/想法（对话式决策）
 * Body: { message: string }
 */
router.post('/desires/:id/respond', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    // 1. 检查 desire 存在
    const { rows: desireRows } = await pool.query(
      'SELECT id, type, content, urgency FROM desires WHERE id = $1',
      [id]
    );
    if (desireRows.length === 0) {
      return res.status(404).json({ error: 'desire not found' });
    }

    const desire = desireRows[0];

    // 2. 将用户回复写入 memory_stream（作为 Cecelia 记忆）
    await pool.query(`
      INSERT INTO memory_stream (content, importance, memory_type, expires_at)
      VALUES ($1, $2, 'user_desire_response', NOW() + INTERVAL '30 days')
    `, [
      `[用户回复 desire] 类型=${desire.type}, 原始内容="${desire.content?.substring(0, 100)}"。用户回复: "${message.trim()}"`,
      Math.min(desire.urgency + 2, 10)
    ]);

    // 3. 更新 desire 状态为 acknowledged
    await pool.query(
      'UPDATE desires SET status = $1 WHERE id = $2',
      ['acknowledged', id]
    );

    // 4. 广播 WebSocket 事件
    const { publishDesireUpdated } = await import('../events/taskEvents.js');
    publishDesireUpdated({ id, status: 'acknowledged', previous_status: 'pending', user_response: message.trim() });

    res.json({ success: true, desire_id: id, status: 'acknowledged' });
  } catch (err) {
    console.error('[API] desires/:id/respond error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


/**
 * GET /api/brain/decomposition/missing
 * 查询缺失拆解任务的 Initiative 列表
 */
router.get('/decomposition/missing', async (req, res) => {
  try {
    // 获取缺失拆解任务的活跃 Initiative
    const activePaths = await getActiveExecutionPaths();

    const missingList = [];

    for (const initiative of activePaths) {
      // 检查任务库存是否充足
      const readyTasksResult = await pool.query(`
        SELECT COUNT(*) as count FROM tasks
        WHERE project_id = $1 AND status = 'queued'
      `, [initiative.id]);

      const readyTasks = parseInt(readyTasksResult.rows[0].count, 10);

      if (readyTasks < INVENTORY_CONFIG.LOW_WATERMARK) {
        missingList.push({
          initiative_id: initiative.id,
          initiative_name: initiative.name,
          kr_id: initiative.kr_id,
          ready_tasks: readyTasks,
          low_watermark: INVENTORY_CONFIG.LOW_WATERMARK,
          target_tasks: INVENTORY_CONFIG.TARGET_READY_TASKS
        });
      }
    }

    res.json({
      success: true,
      missing_initiatives: missingList,
      total_active_paths: activePaths.length,
      low_watermark: INVENTORY_CONFIG.LOW_WATERMARK,
      target_ready_tasks: INVENTORY_CONFIG.TARGET_READY_TASKS
    });

  } catch (err) {
    console.error('[API] decomposition/missing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/decomposition/create-missing
 * 手动触发为缺失拆解任务的 Initiative 创建任务
 */
router.post('/decomposition/create-missing', async (req, res) => {
  try {
    const result = await runDecompositionChecks();

    // 统计创建的任务
    const createdTasks = result.actions?.filter(action => action.action === 'create_decomposition') || [];
    const inventoryTasks = createdTasks.filter(task => task.check === 'inventory_replenishment');
    const initiativeTasks = createdTasks.filter(task => task.check === 'initiative_decomposition');

    res.json({
      success: true,
      message: 'Decomposition check completed',
      summary: result.summary || {},
      created_tasks: {
        total: createdTasks.length,
        inventory_replenishment: inventoryTasks.length,
        initiative_seeding: initiativeTasks.length
      },
      details: {
        active_paths: result.active_paths || [],
        created_tasks: result.created_tasks || []
      }
    });

  } catch (err) {
    console.error('[API] decomposition/create-missing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/decomposition/stats
 * 获取拆解任务统计信息
 */
router.get('/decomposition/stats', async (req, res) => {
  try {
    // 获取活跃的执行路径
    const activePaths = await getActiveExecutionPaths();

    // 获取拆解任务统计
    const decompTasksResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
      FROM tasks
      WHERE (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
    `);

    // 获取库存统计
    const inventoryStats = [];
    let totalLowInventory = 0;

    for (const initiative of activePaths) {
      const readyTasksResult = await pool.query(`
        SELECT COUNT(*) as count FROM tasks
        WHERE project_id = $1 AND status = 'queued'
      `, [initiative.id]);

      const readyTasks = parseInt(readyTasksResult.rows[0].count, 10);
      const isLowInventory = readyTasks < INVENTORY_CONFIG.LOW_WATERMARK;

      if (isLowInventory) totalLowInventory++;

      inventoryStats.push({
        initiative_id: initiative.id,
        initiative_name: initiative.name,
        ready_tasks: readyTasks,
        is_low_inventory: isLowInventory
      });
    }

    // 获取项目和Initiative统计（从新 OKR 表）
    const projectStatsResult = await pool.query(`
      SELECT 'project'::text AS type, status, COUNT(*) AS count
      FROM okr_projects
      GROUP BY status
      UNION ALL
      SELECT 'initiative'::text AS type, status, COUNT(*) AS count
      FROM okr_initiatives
      GROUP BY status
    `);

    const projectStats = {};
    for (const row of projectStatsResult.rows) {
      if (!projectStats[row.type]) projectStats[row.type] = {};
      projectStats[row.type][row.status] = parseInt(row.count, 10);
    }

    res.json({
      success: true,
      summary: {
        active_execution_paths: activePaths.length,
        low_inventory_initiatives: totalLowInventory,
        total_initiatives: activePaths.length
      },
      decomposition_tasks: decompTasksResult.rows[0] || {},
      inventory_stats: inventoryStats,
      project_stats: projectStats,
      config: {
        low_watermark: INVENTORY_CONFIG.LOW_WATERMARK,
        target_ready_tasks: INVENTORY_CONFIG.TARGET_READY_TASKS,
        batch_size: INVENTORY_CONFIG.BATCH_SIZE
      }
    });

  } catch (err) {
    console.error('[API] decomposition/stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 反刍回路 API ──────────────────────────────────────────

/**
 * POST /api/brain/ruminate — 手动触发反刍（跳过 idle check）
 */
router.post('/ruminate', async (req, res) => {
  try {
    const { runManualRumination } = await import('../rumination.js');
    const result = await runManualRumination(pool);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] ruminate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/rumination/status — 反刍系统状态
 */
router.get('/rumination/status', async (req, res) => {
  try {
    const { getRuminationStatus } = await import('../rumination.js');
    const status = await getRuminationStatus(pool);
    res.json(status);
  } catch (err) {
    console.error('[API] rumination/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/learnings — 知识列表（分页 + 筛选）
 * Query: digested=true|false, archived=true|false, limit=20, offset=0
 */
router.get('/learnings', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20'), 100);
    const offset = parseInt(req.query.offset || '0');

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (req.query.digested !== undefined) {
      conditions.push(`digested = $${paramIdx++}`);
      params.push(req.query.digested === 'true');
    }

    // 默认排除 archived，除非明确请求
    if (req.query.archived === 'true') {
      conditions.push(`archived = true`);
    } else {
      conditions.push(`(archived = false OR archived IS NULL)`);
    }

    // 日期过滤（YYYY-MM-DD，Asia/Shanghai 时区）
    if (req.query.date) {
      conditions.push(`DATE(created_at AT TIME ZONE 'Asia/Shanghai') = $${paramIdx++}`);
      params.push(req.query.date);
    }

    const orderDir = req.query.date ? 'ASC' : 'DESC';
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM learnings ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total || 0);

    params.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT id, title, content, category, digested, archived, created_at
       FROM learnings ${where}
       ORDER BY created_at ${orderDir}
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );

    res.json({
      learnings: dataResult.rows,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[API] learnings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Progress Ledger API ──────────────────────────────────────

/**
 * GET /api/brain/progress/:task_id — 获取任务的完整进展历史
 */
router.get('/progress/:task_id', async (req, res) => {
  try {
    const { task_id } = req.params;
    const { run_id } = req.query;

    const { getProgressSteps, getTaskProgressSummary } = await import('../progress-ledger.js');

    const [steps, summary] = await Promise.all([
      getProgressSteps(task_id, run_id),
      getTaskProgressSummary(task_id)
    ]);

    res.json({
      taskId: task_id,
      runId: run_id || null,
      summary,
      steps
    });
  } catch (err) {
    console.error('[API] progress/:task_id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/progress/latest — 获取最新的进展步骤
 */
router.get('/progress/latest', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    const result = await pool.query(`
      SELECT * FROM v_latest_progress_step
      ORDER BY started_at DESC NULLS LAST
      LIMIT $1
    `, [limit]);

    res.json({
      steps: result.rows
    });
  } catch (err) {
    console.error('[API] progress/latest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/progress/anomalies — 获取异常任务列表
 */
router.get('/progress/anomalies', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 1;

    const { getProgressAnomalies } = await import('../progress-ledger.js');
    const anomalies = await getProgressAnomalies(hours);

    res.json({
      hoursWindow: hours,
      anomalies
    });
  } catch (err) {
    console.error('[API] progress/anomalies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/progress/record — 手动记录进展步骤（测试用）
 */
router.post('/progress/record', async (req, res) => {
  try {
    const { taskId, runId, step } = req.body;

    if (!taskId || !runId || !step) {
      return res.status(400).json({ error: 'Missing required fields: taskId, runId, step' });
    }

    const { recordProgressStep } = await import('../progress-ledger.js');
    const ledgerId = await recordProgressStep(taskId, runId, step);

    res.json({
      success: true,
      ledgerId
    });
  } catch (err) {
    console.error('[API] progress/record error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Suggestions API ──────────────────────────────────────────

/**
 * POST /api/brain/suggestions — 创建新的建议
 */
router.post('/suggestions', async (req, res) => {
  try {
    const suggestionData = req.body;

    if (!suggestionData.content || !suggestionData.source) {
      return res.status(400).json({
        success: false,
        error: 'content and source are required'
      });
    }

    const suggestion = await createSuggestion(suggestionData);

    res.json({
      success: true,
      suggestion
    });
  } catch (err) {
    console.error('[API] Create suggestion error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to create suggestion',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/suggestions — 查询建议列表
 */
router.get('/suggestions', async (req, res) => {
  try {
    const {
      status = 'pending',
      limit = 50,
      priority_threshold = 0
    } = req.query;

    const query = `
      SELECT * FROM suggestions
      WHERE status = $1 AND priority_score >= $2 AND expires_at > now()
      ORDER BY priority_score DESC, created_at DESC
      LIMIT $3
    `;

    const result = await pool.query(query, [status, priority_threshold, limit]);

    res.json({
      success: true,
      suggestions: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('[API] Get suggestions error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get suggestions',
      details: err.message
    });
  }
});

/**
 * PUT /api/brain/suggestions/:id/status — 更新建议状态
 */
router.put('/suggestions/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, metadata = {} } = req.body;

    if (!['processed', 'rejected', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: processed, rejected, or archived'
      });
    }

    await updateSuggestionStatus(id, status, metadata);

    res.json({
      success: true,
      message: `Suggestion ${id} status updated to ${status}`
    });
  } catch (err) {
    console.error('[API] Update suggestion status error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update suggestion status',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/suggestions/triage — 执行 triage 处理
 */
router.post('/suggestions/triage', async (req, res) => {
  try {
    const { limit = 50 } = req.body;

    const processedSuggestions = await executeTriage(limit);

    res.json({
      success: true,
      processed_count: processedSuggestions.length,
      suggestions: processedSuggestions.slice(0, 10)
    });
  } catch (err) {
    console.error('[API] Triage suggestions error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to execute triage',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/suggestions/top-priority — 获取优先级最高的建议
 */
router.get('/suggestions/top-priority', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const suggestions = await getTopPrioritySuggestions(parseInt(limit));

    res.json({
      success: true,
      suggestions,
      count: suggestions.length
    });
  } catch (err) {
    console.error('[API] Get top priority suggestions error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get top priority suggestions',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/suggestions/cleanup — 清理过期建议
 */
router.post('/suggestions/cleanup', async (req, res) => {
  try {
    const cleanupCount = await cleanupExpiredSuggestions();

    res.json({
      success: true,
      cleanup_count: cleanupCount,
      message: `Cleaned up ${cleanupCount} expired suggestions`
    });
  } catch (err) {
    console.error('[API] Cleanup suggestions error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup suggestions',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/suggestions/stats — 获取 triage 统计信息
 */
router.get('/suggestions/stats', async (req, res) => {
  try {
    const stats = await getTriageStats();

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('[API] Get triage stats error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get triage stats',
      details: err.message
    });
  }
});

// ── Goal Evaluations API ──────────────────────────────────────────

/**
 * GET /api/brain/goal-evaluations — 查询 goal 评估结果（最新一条/每 goal）
 */
router.get('/goal-evaluations', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    // 新 OKR 表：goal_evaluations.goal_id 对应 key_results.id（UUID 相同）
    const result = await pool.query(`
      SELECT ge.id, ge.goal_id, ge.verdict, ge.metrics, ge.action_taken, ge.action_detail, ge.created_at,
             g.title AS goal_title, g.priority AS goal_priority, g.progress AS goal_progress
      FROM goal_evaluations ge
      JOIN key_results g ON g.id = ge.goal_id
      ORDER BY ge.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json({ success: true, evaluations: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goal evaluations', details: err.message });
  }
});

/**
 * GET /api/brain/goal-evaluations/latest — 每个 goal 的最新评估
 */
router.get('/goal-evaluations/latest', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM v_latest_goal_evaluation ORDER BY goal_priority, created_at DESC`);
    res.json({ success: true, evaluations: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get latest goal evaluations', details: err.message });
  }
});

// ── Self-Model API ──────────────────────────────────────────

/**
 * GET /api/brain/self-model — 读取 Cecelia 当前 self-model
 */
router.get('/self-model', async (_req, res) => {
  try {
    const { getSelfModelRecord } = await import('../self-model.js');
    const record = await getSelfModelRecord(pool);
    res.json(record);
  } catch (err) {
    console.error('[API] self-model error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 闭环回写：dev 任务完成后，将相关 failure_pattern 的 memory_stream 标记为 resolved
 *
 * 策略：从 task 的 title/description 提取关键词，在 failure_pattern learnings 中做
 * 关键词匹配（ILIKE），找到有 source_memory_id 的条目，将对应 memory_stream 标记为 resolved。
 *
 * @param {string} task_id - 已完成的任务 ID
 * @param {import('pg').Pool} db - PostgreSQL 连接池
 */

/**
 * GET /api/brain/learnings/stats
 * Get learnings statistics for RNA KR progress calculation
 */
router.get('/learnings/stats', async (req, res) => {
  try {
    const { getAutoLearningStats } = await import('../auto-learning.js');

    // Get auto-learning runtime stats
    const runtimeStats = getAutoLearningStats();

    // Get database stats
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM learnings');
    const total = parseInt(totalResult.rows[0].total, 10);

    const last7DaysResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM learnings
      WHERE created_at > NOW() - INTERVAL '7 days'
    `);
    const last_7_days = parseInt(last7DaysResult.rows[0].count, 10);

    const byCategoryResult = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM learnings
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY category
      ORDER BY count DESC
    `);
    const by_category = Object.fromEntries(
      byCategoryResult.rows.map(r => [r.category || 'unknown', parseInt(r.count, 10)])
    );

    const byTriggerResult = await pool.query(`
      SELECT trigger_event, COUNT(*) as count
      FROM learnings
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY trigger_event
      ORDER BY count DESC
    `);
    const by_trigger = Object.fromEntries(
      byTriggerResult.rows.map(r => [r.trigger_event || 'unknown', parseInt(r.count, 10)])
    );

    // Return combined stats
    res.json({
      total,
      last_7_days,
      by_category,
      by_trigger,
      runtime: runtimeStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[/learnings/stats] Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch learnings stats' });
  }
});

/**
 * POST /api/brain/feishu/event
 * 飞书 Bot 事件接收端点（增强 v1）
 *
 * 功能：
 * 1. Challenge 验证
 * 2. p2p 私信：滚动上下文 + 多用户识别 → 调用 Cecelia → 回复
 * 3. group 群聊：仅当 @mention Bot 时回复
 *
 * 环境变量：FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_BOT_OPEN_ID（可选）
 */

/** 获取飞书 tenant_access_token（每次请求均获取，飞书 token 有效期2小时） */
async function getFeishuToken() {
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
    signal: AbortSignal.timeout(6000),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`飞书 token 失败: ${data.msg}`);
  return data.tenant_access_token;
}

// 群成员列表内存缓存（chat_id → { names, expiresAt }）
const groupMembersCache = new Map();

// 群消息聚合缓冲区（chat_id → { messages: [], timer, accessToken }）
// 8 秒内同一群的非@mention 消息合并为一次决策
const groupPendingMessages = new Map();

// P2P 消息防抖缓冲区（open_id → { messages: [], accessToken, timer }）
// 3 秒内同一用户的连续消息合并为一次处理
const p2pPendingMessages = new Map();
const P2P_DEBOUNCE_MS = 3000;

/** 获取群成员名单（内存缓存 1小时）— 调飞书 GET /im/v1/chats/{chat_id}/members
 *  副作用：将成员信息写入 feishu_users，使 getFeishuUserName 的 staleCache 生效 */
async function getGroupMembers(chatId, accessToken) {
  const now = Date.now();
  const cached = groupMembersCache.get(chatId);
  if (cached && cached.expiresAt > now) return cached.names;

  try {
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members?member_id_type=open_id&page_size=100`,
      { headers: { 'Authorization': `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) }
    );
    const data = await resp.json();
    if (data.code !== 0) {
      console.warn('[feishu/group] 成员列表 API 失败: code=', data.code, 'chatId=', chatId.slice(-8));
      return [];
    }
    const items = data.data?.items || [];
    const names = items.map(m => m.name).filter(Boolean);
    console.log('[feishu/group] 成员列表获取成功:', items.length, '人, chatId=', chatId.slice(-8));
    groupMembersCache.set(chatId, { names, expiresAt: now + 3600000 });

    // 写入 feishu_users（await 确保写完再返回，避免 getFeishuUserName 读到旧数据）
    await Promise.all(items
      .filter(m => m.member_id && m.name)
      .map(member => {
        const mName = member.name;
        const isOwner = mName.includes('徐啸') || mName.toLowerCase().includes('alex');
        const mRel = isOwner ? 'owner' : 'colleague';
        const mUserId = isOwner ? 'owner' : 'guest';
        return pool.query(
          `INSERT INTO feishu_users (open_id, name, relationship, user_id, fetched_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (open_id) DO UPDATE SET name=$2, relationship=$3, user_id=$4, fetched_at=NOW()`,
          [member.member_id, mName, mRel, mUserId]
        ).catch(err => console.error('[routes] silent error:', err));
      })
    );

    return names;
  } catch (err) {
    console.warn('[feishu/group] 获取群成员失败:', err.message);
    return [];
  }
}

/** 异步更新群聊用户印象（fire-and-forget，写 user_profile_facts category=feishu_group_impression） */
async function updateUserImpression(openId, senderName) {
  try {
    // 查该用户最近 20 条群聊消息
    const msgRows = await pool.query(
      `SELECT content FROM memory_stream
       WHERE source_type='feishu_group' AND content LIKE $1
       ORDER BY created_at DESC LIMIT 20`,
      [`[飞书群聊] ${senderName}: %`]
    );
    if (msgRows.rows.length < 3) return; // 消息不足，跳过

    const recentMsgs = msgRows.rows.map(r => r.content).reverse().join('\n');

    // 查现有印象
    const existRow = await pool.query(
      `SELECT id, content FROM user_profile_facts
       WHERE user_id=$1 AND category='feishu_group_impression'
       ORDER BY created_at DESC LIMIT 1`,
      [openId]
    ).then(r => r.rows[0]).catch(() => null);

    const prompt = existRow?.content
      ? `基于以下新消息，更新对 ${senderName} 的印象（1-2句，简洁）。\n已有印象：${existRow.content}\n新消息：\n${recentMsgs}\n\n只输出新印象描述。`
      : `根据以下消息，简短描述 ${senderName} 的说话风格和关注点（1-2句话）。\n${recentMsgs}\n\n只输出印象描述。`;

    const { text: impression } = await callLLM('mouth', prompt, { timeout: 8000, max_tokens: 150 });
    if (!impression?.trim()) return;

    if (existRow) {
      await pool.query(`UPDATE user_profile_facts SET content=$1 WHERE id=$2`, [impression.trim(), existRow.id]);
    } else {
      await pool.query(
        `INSERT INTO user_profile_facts (user_id, category, content) VALUES ($1, 'feishu_group_impression', $2)`,
        [openId, impression.trim()]
      );
    }
    console.log(`[feishu/impression] 更新 ${senderName} 印象: ${impression.trim().slice(0, 80)}`);
  } catch (err) {
    console.warn(`[feishu/impression] 更新失败 ${senderName}:`, err.message);
  }
}

// 已知用户关系表（名字关键词 → relationship）
// owner 单独通过 API 判断，此表用于识别同事/家人
const FEISHU_KNOWN_RELATIONS = {
  colleague: ['苏彦卿', '于瑾'],   // 团队成员
  family:    [],                    // 家人（后续添加）
};

/** 根据飞书名字推断 relationship */
function inferRelationship(name, en_name, isOwner) {
  if (isOwner) return 'owner';
  const n = (name || '') + (en_name || '');
  for (const [rel, keywords] of Object.entries(FEISHU_KNOWN_RELATIONS)) {
    if (keywords.some(k => n.includes(k))) return rel;
  }
  return 'guest';
}

// FEISHU_OWNER_OPEN_IDS: 逗号分隔的 owner open_id 列表，用于绕过 API 权限不足问题
// 注意：open_id 与 App 绑定，换 App 后必须更新（从 feishu_users 表查询或从 webhook 事件获取）
const _feishuOwnerOpenIds = (process.env.FEISHU_OWNER_OPEN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

/** 获取飞书用户信息（带 DB 缓存，TTL 24小时），返回 name/user_id/relationship */
async function getFeishuUserName(openId, accessToken) {
  // 环境变量 hardcoded owner 检查（绕过 API 权限不足）
  if (_feishuOwnerOpenIds.includes(openId)) {
    return { name: '徐啸', user_id: 'owner', relationship: 'owner' };
  }

  // 先查缓存
  const cached = await pool.query(
    `SELECT name, user_id, relationship FROM feishu_users WHERE open_id = $1 AND fetched_at > NOW() - INTERVAL '24 hours'`,
    [openId]
  );
  if (cached.rows[0]) {
    return {
      name: cached.rows[0].name || '用户',
      user_id: cached.rows[0].user_id || 'guest',
      relationship: cached.rows[0].relationship || 'guest',
    };
  }

  // 从飞书 API 获取用户信息
  let name = null, en_name = null, user_id = 'guest', relationship = 'guest';
  let apiSuccess = false;
  try {
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
      { headers: { 'Authorization': `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) }
    );
    const data = await resp.json();
    if (data.code === 0 && data.data?.user) {
      apiSuccess = true;
      name = data.data.user.name || null;
      en_name = data.data.user.en_name || null;
      const isOwner = !!(name && (name.includes('徐啸') || (en_name && en_name.toLowerCase().includes('alex'))));
      if (isOwner) user_id = 'owner';
      relationship = inferRelationship(name, en_name, isOwner);
      // 写缓存
      await pool.query(
        `INSERT INTO feishu_users (open_id, name, en_name, user_id, relationship, fetched_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (open_id) DO UPDATE SET name=$2, en_name=$3, user_id=$4, relationship=$5, fetched_at=NOW()`,
        [openId, name, en_name, user_id, relationship]
      );
    } else {
      console.warn(`[feishu/event] 联系人 API 返回 code=${data.code}，openId=${openId}，尝试 staleCache 回退`);
    }
  } catch (err) {
    console.warn(`[feishu/event] 获取用户名失败 ${openId}:`, err.message);
  }

  // API 失败时，回退到任何历史缓存记录（ORDER BY fetched_at，忽略 TTL，比默认 guest 更可靠）
  if (!apiSuccess) {
    const staleCache = await pool.query(
      `SELECT name, user_id, relationship FROM feishu_users WHERE open_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
      [openId]
    ).catch(() => ({ rows: [] }));
    if (staleCache.rows[0]) {
      return {
        name: staleCache.rows[0].name || '用户',
        user_id: staleCache.rows[0].user_id || 'guest',
        relationship: staleCache.rows[0].relationship || 'guest',
      };
    }
  }

  return { name: name || '用户', user_id, relationship };
}

/** 下载飞书图片并返回 base64 + media_type */
async function downloadFeishuImage(messageId, imageKey, accessToken) {
  const dlResp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${imageKey}?type=image`,
    { headers: { 'Authorization': `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
  );
  if (!dlResp.ok) throw new Error(`图片下载失败: ${dlResp.status}`);
  const contentType = dlResp.headers.get('content-type') || 'image/jpeg';
  const mediaType = contentType.split(';')[0].trim(); // 'image/jpeg', 'image/png' etc.
  const imageBuffer = await dlResp.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer).toString('base64');
  return { imageBase64, mediaType };
}

/** 语音消息转文字（飞书原生 ASR，支持 ≤60s） */
async function transcribeFeishuAudio(messageId, fileKey, accessToken) {
  // 1. 下载音频文件
  const dlResp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`,
    { headers: { 'Authorization': `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
  );
  if (!dlResp.ok) throw new Error(`音频下载失败: ${dlResp.status}`);
  const audioBuffer = await dlResp.arrayBuffer();
  const audioBase64 = Buffer.from(audioBuffer).toString('base64');

  // 2. 调用飞书 ASR
  const asrResp = await fetch(
    'https://open.feishu.cn/open-apis/speech_to_text/v1/speech/file_recognize',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        speech: { speech: audioBase64 },
        config: { file_id: fileKey, format: 'opus', engine_type: '16k_auto' },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const asrData = await asrResp.json();
  if (asrData.code !== 0) throw new Error(`ASR 失败: ${asrData.msg}`);
  return asrData.data?.recognition_text || '';
}

/**
 * 从 unified_conversations 加载对话历史
 * @param {string} participantId - feishu open_id 或 'owner'
 * @param {number} rounds - 轮数（每轮含 user+assistant 两条）
 * @param {string|null} groupId - 群聊 chat_id（P2P 传 null）
 */
async function getUnifiedHistory(participantId, rounds = 10, groupId = null) {
  let res;
  if (groupId) {
    // 群聊：加载该群的所有对话（多人上下文）
    res = await pool.query(
      `SELECT role, content, image_description FROM unified_conversations
       WHERE group_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [groupId, rounds * 2]
    );
  } else {
    // P2P 或 Dashboard：加载该人的私聊历史
    res = await pool.query(
      `SELECT role, content, image_description FROM unified_conversations
       WHERE participant_id = $1 AND group_id IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [participantId, rounds * 2]
    );
  }
  return res.rows.reverse().map(r => ({
    role: r.role,
    content: r.image_description
      ? `${r.content}（你之前描述过这张图片：${r.image_description.slice(0, 120)}）`
      : r.content,
  }));
}

/**
 * 保存本轮对话到 unified_conversations
 * @param {string} participantId - feishu open_id 或 'owner'
 * @param {string} channel - 'feishu_p2p' | 'feishu_group' | 'dashboard'
 * @param {string|null} groupId - 群聊 chat_id（P2P/Dashboard 传 null）
 * @param {string} userText - 用户消息
 * @param {string} assistantReply - Cecelia 回复
 * @param {string|null} imageDescription - 图片描述摘要（仅图片消息时传入）
 */
async function saveUnifiedConversation(participantId, channel, groupId, userText, assistantReply, imageDescription = null) {
  await pool.query(
    `INSERT INTO unified_conversations (participant_id, channel, group_id, role, content, image_description)
     VALUES ($1, $2, $3, 'user', $4, $5), ($1, $2, $3, 'assistant', $6, NULL)`,
    [participantId, channel, groupId || null, userText, imageDescription, assistantReply]
  );
}

/**
 * 保存单条消息到 unified_conversations（Mode A 用：user/assistant 分两次写入）
 * @param {string} participantId - feishu open_id
 * @param {string} channel - 'feishu_group' 等
 * @param {string} groupId - 群聊 chat_id
 * @param {string} role - 'user' | 'assistant'
 * @param {string} content - 消息内容
 * @param {string|null} imageDescription - 图片描述（仅图片时传入）
 */
async function saveUnifiedMessage(participantId, channel, groupId, role, content, imageDescription = null) {
  await pool.query(
    `INSERT INTO unified_conversations (participant_id, channel, group_id, role, content, image_description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [participantId, channel, groupId || null, role, content, imageDescription]
  );
}

/** 发送飞书消息 */
async function sendFeishuMessage(accessToken, receiveId, receiveIdType, text) {
  try {
    const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json();
    if (data.code !== 0) {
      console.warn(`[feishu/send] 发送失败 code=${data.code} msg=${data.msg} receiveId=${receiveId}`);
    }
  } catch (err) {
    console.warn(`[feishu/send] 发送异常: ${err.message} receiveId=${receiveId}`);
  }
}

/** 发送飞书交互卡片（占位符），返回 message_id */
async function sendFeishuCard(accessToken, receiveId, receiveIdType, placeholder) {
  try {
    const cardContent = {
      config: { wide_screen_mode: true },
      elements: [{ tag: 'div', text: { content: placeholder, tag: 'lark_md' } }],
    };
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(cardContent),
        }),
        signal: AbortSignal.timeout(8000),
      }
    );
    const data = await resp.json();
    return data?.data?.message_id || null;
  } catch (err) {
    console.warn('[feishu/card] sendFeishuCard 失败:', err.message);
    return null;
  }
}

/** PATCH 更新飞书卡片内容 */
async function patchFeishuCard(accessToken, messageId, content) {
  try {
    const cardContent = {
      config: { wide_screen_mode: true },
      elements: [{ tag: 'div', text: { content, tag: 'lark_md' } }],
    };
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ content: JSON.stringify(cardContent) }),
        signal: AbortSignal.timeout(8000),
      }
    );
    const data = await resp.json();
    if (data.code !== 0) {
      console.warn('[feishu/card] patchFeishuCard 失败:', data.code, data.msg);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[feishu/card] patchFeishuCard 异常:', err.message);
    return false;
  }
}

/** GET /api/brain/feishu/users — 查询已知飞书用户（嘴巴 call_brain_api 用） */
router.get('/feishu/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT open_id, name, relationship
      FROM feishu_users
      ORDER BY relationship, name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[feishu/users] 查询失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/brain/feishu/groups — 查询已知飞书群（嘴巴 call_brain_api 用） */
router.get('/feishu/groups', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT group_id,
             COUNT(*) AS msg_count,
             MAX(created_at) AS last_active_at
      FROM unified_conversations
      WHERE group_id IS NOT NULL AND channel = 'feishu_group'
      GROUP BY group_id
      ORDER BY last_active_at DESC
    `);
    res.json(result.rows.map(r => ({
      group_id: r.group_id,
      msg_count: parseInt(r.msg_count),
      last_active_at: r.last_active_at,
    })));
  } catch (err) {
    console.error('[feishu/groups] 查询失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/brain/feishu/send — 主动发飞书消息（嘴巴 call_brain_api 用）
 *  body: { group_id?: string, open_id?: string, text: string }
 */
router.post('/feishu/send', async (req, res) => {
  const { group_id, open_id, text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text 必填' });
  if (!group_id && !open_id) return res.status(400).json({ error: 'group_id 或 open_id 必填一个' });

  try {
    const accessToken = await getFeishuToken();
    const receiveId = group_id || open_id;
    const receiveIdType = group_id ? 'chat_id' : 'open_id';
    await sendFeishuMessage(accessToken, receiveId, receiveIdType, text);
    console.log(`[feishu/send] 已发送到 ${receiveIdType}=${receiveId.slice(-8)}: ${text.slice(0, 60)}`);
    res.json({ success: true, receiveId, receiveIdType });
  } catch (err) {
    console.error('[feishu/send] 发送失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/feishu/event', async (req, res) => {
  const body = req.body;

  // 1. Challenge 验证
  if (body.challenge) {
    return res.json({ challenge: body.challenge });
  }

  // 2. 只处理 im.message.receive_v1
  if (body?.header?.event_type !== 'im.message.receive_v1') {
    return res.json({ ok: true });
  }

  const msgEvent = body.event;
  const message = msgEvent?.message;
  const sender = msgEvent?.sender;

  if (!message) return res.json({ ok: true });

  const chatType = message.chat_type;   // 'p2p' 或 'group'
  const msgType = message.message_type; // 'text', 'audio', ...

  // 只处理 text、audio、image
  if (msgType !== 'text' && msgType !== 'audio' && msgType !== 'image') return res.json({ ok: true });

  // p2p 或 group（group 需要 @mention）
  if (chatType !== 'p2p' && chatType !== 'group') return res.json({ ok: true });

  const openId = sender?.sender_id?.open_id;
  if (!openId) return res.json({ ok: true });

  // 提取文本、音频 file_key 或图片 image_key
  let text = '';
  let audioFileKey = null;
  let imageKey = null;

  if (msgType === 'text') {
    try {
      const contentObj = JSON.parse(message.content || '{}');
      text = contentObj.text || '';
    } catch {
      return res.json({ ok: true });
    }
    if (!text.trim()) return res.json({ ok: true });
  } else if (msgType === 'audio') {
    try {
      const contentObj = JSON.parse(message.content || '{}');
      audioFileKey = contentObj.file_key || '';
    } catch {
      return res.json({ ok: true });
    }
    if (!audioFileKey) return res.json({ ok: true });
  } else if (msgType === 'image') {
    try {
      const contentObj = JSON.parse(message.content || '{}');
      imageKey = contentObj.image_key || '';
    } catch {
      return res.json({ ok: true });
    }
    if (!imageKey) return res.json({ ok: true });
    text = '[图片]'; // 保留模态元数据，让对话历史知道这是图片事件
  }

  // 群聊：检查是否被 @mention（Mode A：不再拦截非 @mention 消息）
  let isGroupMention = false;
  if (chatType === 'group') {
    const mentions = message.mentions || [];
    const botOpenId = process.env.FEISHU_BOT_OPEN_ID;
    if (botOpenId) {
      isGroupMention = mentions.some(m => m.id?.open_id === botOpenId);
    } else {
      // 没有配置 BOT_OPEN_ID，用名字匹配（兜底）
      isGroupMention = mentions.some(m => m.name === 'Cecelia' || m.name === 'cecelia');
    }

    // 去除 @Cecelia 前缀（仅 @mention 的文本消息）
    if (isGroupMention && msgType === 'text') {
      text = text.replace(/@\S+\s*/g, '').trim();
      if (!text) return res.json({ ok: true });
    }
  }

  // 立即返回 200（飞书要求 3 秒内响应）
  res.json({ ok: true });

  // 异步处理
  (async () => {
    try {
      const accessToken = await getFeishuToken();

      // 音频消息：转文字
      if (msgType === 'audio') {
        try {
          text = await transcribeFeishuAudio(message.message_id, audioFileKey, accessToken);
        } catch (err) {
          console.warn('[feishu/event] 语音转文字失败:', err.message);
          const errReceiveId = chatType === 'group' ? message.chat_id : openId;
          const errReceiveIdType = chatType === 'group' ? 'chat_id' : 'open_id';
          await sendFeishuMessage(accessToken, errReceiveId, errReceiveIdType, '抱歉，没听清楚，可以发文字吗？');
          return;
        }
        if (!text) {
          const errReceiveId = chatType === 'group' ? message.chat_id : openId;
          const errReceiveIdType = chatType === 'group' ? 'chat_id' : 'open_id';
          await sendFeishuMessage(accessToken, errReceiveId, errReceiveIdType, '抱歉，没听清楚，可以发文字吗？');
          return;
        }
      }

      // 图片消息：下载并构建 imageContent（多模态）
      let feishuImageContent = null;
      if (msgType === 'image' && imageKey) {
        try {
          const { imageBase64, mediaType } = await downloadFeishuImage(message.message_id, imageKey, accessToken);
          feishuImageContent = [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } }];
          console.log(`[feishu/event] 图片下载成功, imageKey=${imageKey}, mediaType=${mediaType}, size=${imageBase64.length}`);
        } catch (err) {
          console.warn('[feishu/event] 图片下载失败:', err.message);
          // 降级：当作纯文字消息处理（text = '[图片消息]'）
        }
      }

      // 群聊：预拉取成员信息，填充 feishu_users（使 getFeishuUserName 的 staleCache 生效）
      if (chatType === 'group') await getGroupMembers(message.chat_id, accessToken).catch(err => console.error('[routes] silent error:', err));

      // 获取用户信息（含 relationship）
      const { name: senderName, user_id: userId, relationship } = await getFeishuUserName(openId, accessToken);

      // Mode A：群聊非 @mention 消息 → 8秒聚合窗口 → 一次性决策+回复
      if (chatType === 'group' && !isGroupMention) {
        console.log(`[feishu/group] 非@mention，加入聚合缓冲... 发送者: ${senderName}，内容: ${text.slice(0, 60)}`);

        // 无论是否回复，都立即记录到 memory_stream（以人为中心的统一记忆）
        const groupMemoryContent = `[飞书群聊] ${senderName}: ${text}`;
        pool.query(
          `INSERT INTO memory_stream (content, summary, importance, memory_type, source_type, expires_at)
           VALUES ($1, $2, 2, 'short', 'feishu_group', NOW() + INTERVAL '7 days')`,
          [groupMemoryContent, groupMemoryContent.slice(0, 100)]
        ).catch(err => console.warn('[feishu/group] memory_stream 写入失败:', err.message));

        // Alex 群聊消息也更新 last_alex_chat_at（让感知层知道 Alex 今天来过）
        if (relationship === 'owner') {
          const nowIso = JSON.stringify(new Date().toISOString());
          pool.query(
            `INSERT INTO working_memory (key, value_json, updated_at)
             VALUES ('last_alex_chat_at', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
            [nowIso]
          ).catch(err => console.warn('[feishu/group] last_alex_chat_at 写入失败:', err.message));
        }

        // 记录到 unified_conversations（per-person 行为数据，供 person_model 分析）
        saveUnifiedMessage(openId, 'feishu_group', message.chat_id, 'user', text, null)
          .catch(err => console.warn('[feishu/group] unified_conversations user 写入失败:', err.message));

        // 异步更新发送者印象（fire-and-forget）
        updateUserImpression(openId, senderName).catch(err => console.error('[routes] silent error:', err));

        // 消息聚合：加入 chat_id 对应的缓冲区，8秒后统一处理
        const chatId = message.chat_id;
        if (!groupPendingMessages.has(chatId)) {
          groupPendingMessages.set(chatId, { messages: [], accessToken });
        }
        const pending = groupPendingMessages.get(chatId);
        pending.messages.push({ senderName, text, userId, relationship, openId, imageContent: feishuImageContent });
        // 重置 timer（新消息到来时延后处理时机）
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = setTimeout(async () => {
          groupPendingMessages.delete(chatId);
          const batch = pending.messages;
          if (!batch.length) return;

          // 以最后一条消息的发送者为"主要对话方"
          const primarySender = batch[batch.length - 1];

          try {
            // 注入最近群聊历史（对话连续性）
            const recentRows = await pool.query(
              `SELECT content FROM memory_stream WHERE source_type='feishu_group' ORDER BY created_at DESC LIMIT 6`
            ).then(r => r.rows.map(r => r.content).reverse()).catch(() => []);
            const recentBlock = recentRows.length
              ? `\n最近群聊历史（从旧到新）：\n${recentRows.join('\n')}\n`
              : '';

            // 构建本批消息摘要（可能多人）
            const batchSummary = batch.map(m => `${m.senderName}: ${m.text}`).join('\n');

            // Step 1: Haiku 判断 should_reply（超时 10s，解析失败默认 false）
            const decisionPrompt = `群里有人发了消息，判断 Cecelia 是否需要回复。${recentBlock}\n本批消息（${batch.length}条）：\n${batchSummary}\n\n判断标准（宽松优先）：\n- 疑问句、"你"开头、含"能/会/可以/多少/几个"等 → 回复\n- 涉及 Cecelia 的能力、状态、工作 → 回复\n- 跟进 Cecelia 上文的追问 → 回复\n- 纯语气词（"哈哈"/"好"/"嗯"/"收到"） → 不回复\n- 明显成员间闲聊、与 AI 无关 → 不回复\n- 不确定 → 回复\n\n只输出 JSON：{"should_reply":true} 或 {"should_reply":false}`;
            let shouldReply = false;
            try {
              const { text: decisionText } = await callLLM('mouth', decisionPrompt, { timeout: 10000, max_tokens: 20 });
              const jsonMatch = decisionText.match(/\{[\s\S]*\}/);
              const decision = JSON.parse(jsonMatch ? jsonMatch[0] : decisionText.trim());
              shouldReply = !!decision.should_reply;
              console.log(`[feishu/group] LLM 决策: should_reply=${shouldReply}，批次=${batch.length}条`);
            } catch (decisionErr) {
              console.warn('[feishu/group] LLM 决策失败，默认不回复:', decisionErr.message);
              return;
            }
            if (!shouldReply) return;

            // Step 2: 调 handleChat 生成回复（工作圈：工作相关话题均可聊）
            const modeParts = [`回复时在开头用对方名字称呼（直接写名字，如"${primarySender.senderName}，..."）`];
            if (primarySender.relationship === 'colleague') {
              modeParts.push('工作圈模式：工作相关话题均可聊，包括项目进展、任务状态、日常协作，保持自然友好');
            } else if (primarySender.relationship === 'guest') {
              modeParts.push('权限：访客，仅基础帮助，不涉及公司/个人信息');
            }
            const modeAMemberNames = await getGroupMembers(chatId, pending.accessToken);
            if (modeAMemberNames.length > 0) modeParts.push(`群成员包括 ${modeAMemberNames.join('、')}`);
            // 如果批次有多条消息，把完整上下文传入
            const contextPrefix = batch.length > 1
              ? `[群聊上下文：${modeParts.join('；')}]\n（本批 ${batch.length} 条消息）\n${batchSummary}`
              : `[群聊上下文：${modeParts.join('；')}] ${primarySender.text}`;

            // 如果批次中有图片，取最后一张
            const batchImageContent = batch.slice().reverse().find(m => m.imageContent)?.imageContent || null;
            const modeAResult = await handleChat(contextPrefix, {
              source: 'feishu',
              sender_name: primarySender.senderName,
              user_id: primarySender.userId,
              relationship: primarySender.relationship,
            }, [], batchImageContent);
            const reply = modeAResult?.reply;
            if (!reply) {
              console.warn('[feishu/group] handleChat 无回复，跳过');
              return;
            }

            await sendFeishuMessage(pending.accessToken, chatId, 'chat_id', reply);
            console.log(`[feishu/group] Mode A 回复（批次 ${batch.length} 条）→ ${primarySender.senderName}：${reply.slice(0, 60)}`);

            // Mode A 回复写 unified_conversations assistant 行（归属主要对话方）
            saveUnifiedMessage(primarySender.openId, 'feishu_group', chatId, 'assistant', reply, null)
              .catch(err => console.warn('[feishu/group] unified_conversations assistant 写入失败:', err.message));

            // 回复写入记忆
            const replyMemContent = `[飞书群聊] Cecelia 回复 ${primarySender.senderName}: ${reply}`;
            pool.query(
              `INSERT INTO memory_stream (content, summary, importance, memory_type, source_type, expires_at)
               VALUES ($1, $2, 4, 'short', 'feishu_group', NOW() + INTERVAL '30 days')`,
              [replyMemContent, replyMemContent.slice(0, 100)]
            ).catch(err => console.warn('[feishu/group] memory_stream 回复写入失败:', err.message));
          } catch (err) {
            console.warn('[feishu/group] Mode A 批处理失败:', err.message);
          }
        }, 8000); // 8 秒聚合窗口

        return;
      }

      // P2P 消息 3 秒防抖聚合（合并连续多条消息）
      if (chatType === 'p2p') {
        if (!p2pPendingMessages.has(openId)) {
          p2pPendingMessages.set(openId, { messages: [], accessToken: null, timer: null });
        }
        const p2pPend = p2pPendingMessages.get(openId);
        p2pPend.accessToken = accessToken;
        p2pPend.messages.push({ text, senderName, userId, relationship, imageContent: feishuImageContent });
        if (p2pPend.timer) clearTimeout(p2pPend.timer);
        p2pPend.timer = setTimeout(async () => {
          p2pPendingMessages.delete(openId);
          const batch = p2pPend.messages;
          if (!batch.length) return;
          const combinedText = batch.length > 1 ? batch.map(m => m.text).join('\n') : batch[0].text;
          const primary = batch[batch.length - 1];
          const batchImageContent = batch.slice().reverse().find(m => m.imageContent)?.imageContent || null;
          try {
            const p2pHistory = await getUnifiedHistory(openId, 10, null);
            const thalamusEvent = {
              type: EVENT_TYPES.USER_MESSAGE,
              message: combinedText,
              sender_name: primary.senderName,
              user_id: primary.userId,
              relationship: primary.relationship,
              conversation_id: openId,
              messages: p2pHistory.slice(-5),
              chat_type: 'p2p',
            };
            let mouthReply = '', needCard = false, thalamusRouted = false;
            try {
              const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
              const action = thalamusDecision?.actions?.[0];
              mouthReply = thalamusDecision?.mouth_reply || '';
              needCard = !!thalamusDecision?.need_card;
              if (action?.type === 'create_task' || action?.type === 'dispatch_task') {
                const execResult = await executeThalamusDecision(thalamusDecision);
                const taskTitle = action.params?.title || combinedText.slice(0, 50);
                if (!mouthReply) mouthReply = `好的，我去做：${taskTitle}`;
                thalamusRouted = true;
                // 异步回调任务：注册 task_interest 订阅，任务完成时触发飞书回调
                // 支持的类型由 task-router.js 的 ASYNC_CALLBACK_TYPES 定义，扩展新能力只改那里
                if (ASYNC_CALLBACK_TYPES.has(action.params?.task_type)) {
                  const createdTaskId = execResult?.actions_executed?.[0]?.result?.task_id;
                  if (createdTaskId) {
                    pool.query(
                      `INSERT INTO working_memory (key, value_json, updated_at)
                       VALUES ($1, $2, NOW())
                       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
                      [`task_interest:${createdTaskId}`, JSON.stringify({ source: 'p2p_query', query: combinedText })]
                    ).catch(err => console.warn('[feishu/p2p] task_interest 写入失败:', err.message));
                    if (!thalamusDecision?.mouth_reply) mouthReply = '正在查，马上给你～';
                    console.log(`[feishu/p2p] ${action.params?.task_type} 任务 ${createdTaskId} 已注册 task_interest 订阅`);
                  }
                }
              }
            } catch (thalamusErr) {
              console.warn('[feishu/p2p] 丘脑路由失败:', thalamusErr.message);
            }
            if (mouthReply) {
              if (needCard && !thalamusRouted) {
                const cardMsgId = await sendFeishuCard(p2pPend.accessToken, openId, 'open_id', '正在思考...');
                handleChat(combinedText, {
                  source: 'feishu',
                  sender_name: primary.senderName,
                  user_id: primary.userId,
                  relationship: primary.relationship,
                }, p2pHistory, batchImageContent).then(async (chatResult) => {
                  const finalReply = chatResult?.reply;
                  if (finalReply) {
                    if (cardMsgId) await patchFeishuCard(p2pPend.accessToken, cardMsgId, finalReply);
                    saveUnifiedConversation(openId, 'feishu_p2p', null, combinedText, finalReply, null).catch(() => {});
                  }
                }).catch(err => console.warn('[feishu/p2p] handleChat 卡片模式失败:', err.message));
                console.log(`[feishu/p2p] 卡片模式回复（批次 ${batch.length} 条）→ ${primary.senderName}`);
              } else {
                await sendFeishuMessage(p2pPend.accessToken, openId, 'open_id', mouthReply);
                saveUnifiedConversation(openId, 'feishu_p2p', null, combinedText, mouthReply, null).catch(() => {});
                console.log(`[feishu/p2p] 文字回复（批次 ${batch.length} 条）→ ${primary.senderName}：${mouthReply.slice(0, 60)}`);
              }
              return;
            }
            if (thalamusRouted) return;
            // thalamus 未处理 → fallback 到 handleChat
            const fallbackResult = await handleChat(combinedText, {
              source: 'feishu',
              sender_name: primary.senderName,
              user_id: primary.userId,
              relationship: primary.relationship,
            }, p2pHistory, batchImageContent);
            const fallbackReply = fallbackResult?.reply;
            if (!fallbackReply) return;
            saveUnifiedConversation(openId, 'feishu_p2p', null, combinedText, fallbackReply, null).catch(() => {});
            await sendFeishuMessage(p2pPend.accessToken, openId, 'open_id', fallbackReply);
            console.log(`[feishu/p2p] Fallback 回复 ${primary.senderName}：${fallbackReply.slice(0, 60)}`);
          } catch (err) {
            console.error('[feishu/p2p] P2P 防抖处理失败:', err.message);
          }
        }, P2P_DEBOUNCE_MS);
        return;
      }

      // 加载对话历史（p2p 按人，群聊按 chat_id）
      const messages = await getUnifiedHistory(
        openId,
        10,
        chatType === 'group' ? message.chat_id : null
      );

      // 群聊 @mention：注入权限 + 发送者印象 + 成员名单
      let enrichedText = text;
      if (chatType === 'group') {
        const parts = [];
        // 始终注入发送者姓名，让 LLM 知道"我是谁"的回答对象
        parts.push(`发送者：${senderName}`);
        // 权限控制（colleague 限工作话题，guest 限基础帮助）
        if (relationship === 'colleague') parts.push('权限：同事，仅讨论工作相关话题');
        else if (relationship === 'guest') parts.push('权限：访客，仅基础帮助，不涉及公司/个人信息');
        // 注入发送者 impression
        const impRow = await pool.query(
          `SELECT content FROM user_profile_facts WHERE user_id=$1 AND category='feishu_group_impression' ORDER BY created_at DESC LIMIT 1`,
          [openId]
        ).then(r => r.rows[0]).catch(() => null);
        if (impRow?.content) {
          parts.push(`关于 ${senderName}：${impRow.content}`);
        }
        // 注入群成员名单
        const memberNames = await getGroupMembers(message.chat_id, accessToken);
        if (memberNames.length > 0) {
          parts.push(`群成员包括 ${memberNames.join('、')}`);
        }
        if (parts.length > 0) {
          enrichedText = `[群聊上下文：${parts.join('；')}] ${text}`;
        }
      }

      // 丘脑路由（Gateway 统一入口）：先让丘脑决定怎么处理这条消息
      let thalamusRouted = false;
      try {
        const thalamusEvent = {
          type: EVENT_TYPES.USER_MESSAGE,
          message: enrichedText,
          sender_name: senderName,
          user_id: userId,
          relationship,
          conversation_id: openId,
          messages: messages.slice(-5), // 最近 5 条历史
          chat_type: chatType,
        };
        const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
        const action = thalamusDecision?.actions?.[0];
        if (action?.type === 'create_task' || action?.type === 'dispatch_task') {
          // 丘脑决定派发任务：创建任务，回复确认
          await executeThalamusDecision(thalamusDecision);
          const taskTitle = action.params?.title || enrichedText.slice(0, 50);
          const confirmReply = `好的，我去做：${taskTitle}`;
          const receiveId = chatType === 'group' ? message.chat_id : openId;
          const receiveIdType = chatType === 'group' ? 'chat_id' : 'open_id';
          await sendFeishuMessage(accessToken, receiveId, receiveIdType, confirmReply);
          console.log(`[feishu/thalamus] 派发任务：${taskTitle}`);
          thalamusRouted = true;
        }
        // handle_chat / fallback_to_tick / no_action / 其他 → fallthrough 到 handleChat
      } catch (thalamusErr) {
        console.warn('[feishu/thalamus] 丘脑路由失败，fallback 到 handleChat:', thalamusErr.message);
      }
      if (thalamusRouted) return;

      // 调用 Cecelia（支持图片多模态）
      const result = await handleChat(enrichedText, {
        source: 'feishu',
        sender_name: senderName,
        user_id: userId,
        relationship,
      }, messages, feishuImageContent);
      const reply = result?.reply;
      if (!reply) return;

      // 保存对话历史到 unified_conversations（p2p 和群聊 @mention 均保存）
      {
        const channel = chatType === 'p2p' ? 'feishu_p2p' : 'feishu_group';
        const groupId = chatType === 'group' ? message.chat_id : null;
        // 图片消息：将 reply 前 150 字作为 image_description，供下轮注入上下文
        const imageDesc = msgType === 'image' ? reply.slice(0, 150) : null;
        saveUnifiedConversation(openId, channel, groupId, text, reply, imageDesc).catch(err =>
          console.warn('[feishu/event] 保存历史失败:', err.message)
        );
      }

      // 发送回复
      const receiveId = chatType === 'group' ? message.chat_id : openId;
      const receiveIdType = chatType === 'group' ? 'chat_id' : 'open_id';
      await sendFeishuMessage(accessToken, receiveId, receiveIdType, reply);

      console.log(`[feishu/event] 回复 ${senderName}(${chatType})：${reply.slice(0, 60)}...`);
    } catch (err) {
      console.error('[feishu/event] 处理失败:', err.message);
    }
  })();
});

/**
 * GET /api/brain/dispatch/weights
 * 查看当前 queued 任务的派发权重（用于调试和监控）
 */
router.get('/dispatch/weights', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const result = await pool.query(`
      SELECT id, title, priority, task_type, queued_at, created_at, status, payload, metadata
      FROM tasks
      WHERE status = 'queued'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const taskWeights = getTaskWeights(result.rows);
    // Sort by weight descending for readability
    taskWeights.sort((a, b) => b.weight - a.weight);

    res.json({
      tasks: taskWeights,
      count: taskWeights.length,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[API] dispatch/weights error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/dispatch/stats
 * 获取任务派发统计信息（取消数量、等待时间、积压量等）
 */
router.get('/dispatch/stats', async (req, res) => {
  try {
    const stats = await getCleanupStats(pool);
    res.json(stats);
  } catch (err) {
    console.error('[API] dispatch/stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/dispatch/cleanup
 * 手动触发任务清理（取消过期 recurring 任务，归档过期 paused 任务）
 */
router.post('/dispatch/cleanup', async (req, res) => {
  try {
    const dryRun = req.query.dry_run === 'true' || req.body?.dry_run === true;
    const stats = await runTaskCleanup(pool, { dryRun });
    res.json({
      success: true,
      dry_run: dryRun,
      ...stats
    });
  } catch (err) {
    console.error('[API] dispatch/cleanup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/zombie-cleanup
 * 手动触发僵尸资源清理（stale slots + 孤儿 worktrees）
 */
router.post('/zombie-cleanup', async (req, res) => {
  try {
    const { runZombieCleanup } = await import('../zombie-cleaner.js');
    const report = await runZombieCleanup(pool);
    res.json({ success: true, ...report });
  } catch (err) {
    console.error('[API] zombie-cleanup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/dispatch/effectiveness
 * 派发效果监控端点
 *
 * 返回：
 * - canceled_by_type: 24h 内 canceled 任务按 task_type 分组统计
 * - initiative_plan_cancel_rate: initiative_plan 任务的取消率
 * - avg_wait_by_priority: 各优先级的平均等待时长（分钟）
 * - weight_system_active: 权重系统是否生效（队列中有任务且能按权重排序）
 * - queued_snapshot: 当前队列快照（按权重排序的前 10 个任务）
 */
router.get('/dispatch/effectiveness', async (req, res) => {
  try {
    // 1. 24h 内 canceled 任务按 task_type 分组
    const canceledByTypeResult = await pool.query(`
      SELECT
        COALESCE(task_type, 'unknown') as task_type,
        COUNT(*) as count
      FROM tasks
      WHERE status IN ('canceled', 'cancelled')
        AND updated_at >= NOW() - INTERVAL '24 hours'
      GROUP BY task_type
      ORDER BY count DESC
    `);

    const canceledByType = {};
    let totalCanceled24h = 0;
    for (const row of canceledByTypeResult.rows) {
      canceledByType[row.task_type] = parseInt(row.count);
      totalCanceled24h += parseInt(row.count);
    }

    // 2. initiative_plan 取消率（24h 内完成 + 取消 的比例）
    const initiativePlanStatsResult = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM tasks
      WHERE task_type = 'initiative_plan'
        AND updated_at >= NOW() - INTERVAL '24 hours'
        AND status IN ('canceled', 'cancelled', 'completed', 'failed')
      GROUP BY status
    `);

    let initiativePlanCanceled = 0;
    let initiativePlanCompleted = 0;
    for (const row of initiativePlanStatsResult.rows) {
      const count = parseInt(row.count);
      if (row.status === 'canceled' || row.status === 'cancelled') {
        initiativePlanCanceled += count;
      } else if (row.status === 'completed') {
        initiativePlanCompleted += count;
      }
    }

    const initiativePlanTotal = initiativePlanCanceled + initiativePlanCompleted;
    const initiativePlanCancelRate = initiativePlanTotal > 0
      ? Math.round((initiativePlanCanceled / initiativePlanTotal) * 100 * 10) / 10
      : 0;

    // 3. 平均等待时长（按优先级）
    const avgWaitResult = await pool.query(`
      SELECT priority,
             ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - queued_at)) / 60)::numeric, 1) as avg_wait_minutes
      FROM tasks
      WHERE status = 'queued'
        AND queued_at IS NOT NULL
      GROUP BY priority
    `);

    const avgWaitByPriority = {};
    for (const row of avgWaitResult.rows) {
      avgWaitByPriority[row.priority] = parseFloat(row.avg_wait_minutes) || 0;
    }

    // 4. 权重系统验证：获取队列中的任务并计算权重
    const queuedTasksResult = await pool.query(`
      SELECT id, title, priority, task_type, queued_at, created_at, status, payload, metadata
      FROM tasks
      WHERE status = 'queued'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const weightSystemActive = queuedTasksResult.rows.length > 0;
    const taskWeights = weightSystemActive ? getTaskWeights(queuedTasksResult.rows) : [];
    taskWeights.sort((a, b) => b.weight - a.weight);

    // 5. 构造响应
    res.json({
      canceled_by_type: canceledByType,
      total_canceled_24h: totalCanceled24h,
      initiative_plan_cancel_rate: initiativePlanCancelRate,
      initiative_plan_stats: {
        canceled_24h: initiativePlanCanceled,
        completed_24h: initiativePlanCompleted,
        total_24h: initiativePlanTotal,
        cancel_rate_percent: initiativePlanCancelRate
      },
      avg_wait_by_priority: avgWaitByPriority,
      weight_system_active: weightSystemActive,
      queued_snapshot: taskWeights.slice(0, 10).map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        task_type: t.task_type,
        weight: t.weight
      })),
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[API] dispatch/effectiveness error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/cleanup/audit
 * 获取任务清理审计日志（内存中的最近操作记录）
 *
 * Query params:
 * - limit: 返回条数（默认 100，最大 500）
 *
 * 返回：
 * - audit_log: 审计记录数组（从新到旧）
 * - count: 实际返回条数
 * - note: 说明（内存日志，重启后清空）
 */
router.get('/cleanup/audit', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const auditLog = getCleanupAuditLog(limit);

    res.json({
      audit_log: auditLog,
      count: auditLog.length,
      note: 'In-memory audit log. Cleared on Brain restart.',
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[API] cleanup/audit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/manual/ask
 * 说明书实时问答端点（SSE）
 * Body: { question: string }
 * Response: text/event-stream — 格式 `data: {"delta":"..."}\n\n`，结束为 `data: [DONE]\n\n`
 * 调用 MiniMax 流式回答，以 brain-manifest.generated.json 作为上下文
 */
router.post('/manual/ask', async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    res.status(400).json({ error: 'question is required' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });

  try {
    // 读取 manifest 作为 context
    const manifestRaw = readFileSync(new URL('./brain-manifest.generated.json', import.meta.url), 'utf8');
    const manifest = JSON.parse(manifestRaw);

    // 构建精简 context（控制 token 量）
    const contextLines = ['# Brain Manifest 概览\n'];
    if (manifest.blocks) {
      manifest.blocks.forEach(b => {
        contextLines.push(`## ${b.label} (${b.id})`);
        if (b.desc) contextLines.push(b.desc);
        if (b.modules) {
          b.modules.forEach(m => contextLines.push(`  - ${m.id}: ${m.label}${m.desc ? ' — ' + m.desc : ''}`));
        }
      });
    }
    if (manifest.allActions) {
      const actionKeys = Object.keys(manifest.allActions);
      contextLines.push(`\n## Actions 白名单（共 ${actionKeys.length} 条）`);
      actionKeys.slice(0, 40).forEach(k => {
        const a = manifest.allActions[k];
        contextLines.push(`  ${k}: ${a.description || ''}${a.dangerous ? ' [危险]' : ''}`);
      });
    }
    if (manifest.allSignals) {
      contextLines.push(`\n## 感知信号（共 ${manifest.allSignals.length} 个）`);
      manifest.allSignals.slice(0, 20).forEach(s => {
        contextLines.push(`  #${s.id}: ${s.label} — ${s.description || ''}`);
      });
    }
    const contextStr = contextLines.join('\n');

    // 合并 system context 与 question（MiniMax 用 user message，无 top-level system 字段）
    const combinedPrompt = `你是 Brain 系统的技术说明员。根据以下 Brain manifest 数据，简明扼要地回答关于 Brain 架构的技术问题。使用中文回答，保持简洁专业。\n\n${contextStr}\n\n用户问题：${question.trim()}`;

    // 通过 callLLMStream 调用 MiniMax 流式 API（mouth agentId）
    await callLLMStream('mouth', combinedPrompt, {}, (delta, isDone) => {
      if (isDone) {
        if (!closed) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } else if (delta && !closed) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    });
  } catch (err) {
    console.error('[API] manual/ask error:', err.message);
    if (!closed) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

/**
 * GET /api/brain/reports
 * 查询 system_reports 历史简报
 * Query params: ?type=48h_summary&limit=10
 */
router.get('/reports', async (req, res) => {
  try {
    const type = req.query.type || null;
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 100);

    let query = `
      SELECT id, type, content, metadata, created_at
      FROM system_reports
    `;
    const params = [];

    if (type) {
      query += ' WHERE type = $1';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({
      success: true,
      reports: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('[API] reports GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/reports/latest
 * 获取最新的系统简报
 * Query params: ?type=48h_summary（可选，默认返回最新任意类型）
 */
router.get('/reports/latest', async (req, res) => {
  try {
    const type = req.query.type || null;

    let query = `
      SELECT id, type, content, metadata, created_at
      FROM system_reports
    `;
    const params = [];

    if (type) {
      query += ' WHERE type = $1';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT 1';

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '暂无系统简报' });
    }

    res.json({ success: true, report: result.rows[0] });
  } catch (err) {
    console.error('[API] reports/latest error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/reports/generate
 * 手动触发 cortex 生成系统简报（使用 LLM 深度分析）
 * Body: { time_range_hours: 48 }（可选）
 */
router.post('/reports/generate', async (req, res) => {
  try {
    const timeRangeHours = Math.max(1, Math.min(168, Number(req.body?.time_range_hours) || 48));
    const { generateSystemReport } = await import('../cortex.js');
    const report = await generateSystemReport({ timeRangeHours });
    res.json({
      success: true,
      report_id: report.id,
      generated_at: report.generated_at,
      time_range_hours: timeRangeHours,
      message: `${timeRangeHours}h 系统简报已成功生成`
    });
  } catch (err) {
    console.error('[API] reports/generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/reports/trigger
 * 手动触发 48h 简报生成（强制，忽略时间检查）
 */
router.post('/reports/trigger', async (req, res) => {
  try {
    const record = await check48hReport(pool, { force: true });
    if (!record) {
      return res.status(500).json({ success: false, error: '简报生成失败，请查看服务器日志' });
    }
    res.json({
      success: true,
      report_id: record.id,
      created_at: record.created_at,
      message: '48h 简报已成功生成'
    });
  } catch (err) {
    console.error('[API] reports/trigger error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/pr-progress/:kr_id
 * 获取指定 KR 的 PR 进度数据
 *
 * Query params:
 *   - month: string (YYYY-MM) 指定月份，默认当前月
 *
 * Response:
 *   {
 *     kr_id, kr_title, target_count, completed_count, in_progress_count,
 *     failed_count, progress_percentage, time_range, daily_breakdown, last_updated
 *   }
 */
router.get('/pr-progress/:kr_id', async (req, res) => {
  try {
    const { kr_id } = req.params;
    const { month } = req.query;

    // 解析月份参数
    let year, monthNum;
    if (month) {
      const monthMatch = /^(\d{4})-(\d{2})$/.exec(month);
      if (!monthMatch) {
        return res.status(400).json({
          success: false,
          error: 'month 参数格式错误，请使用 YYYY-MM 格式（例：2026-03）'
        });
      }
      year = parseInt(monthMatch[1], 10);
      monthNum = parseInt(monthMatch[2], 10);
      if (monthNum < 1 || monthNum > 12) {
        return res.status(400).json({
          success: false,
          error: 'month 参数月份值无效（1-12）'
        });
      }
    } else {
      const now = new Date();
      year = now.getUTCFullYear();
      monthNum = now.getUTCMonth() + 1;
    }

    // 计算时间范围（月份首日 UTC 00:00:00 ~ 末日 UTC 23:59:59）
    const rangeStart = new Date(Date.UTC(year, monthNum - 1, 1));
    const rangeEnd = new Date(Date.UTC(year, monthNum, 1) - 1); // 月末最后一毫秒

    // 查询 KR 信息（key_results 表，与 task-router.js 一致）
    const goalResult = await pool.query(
      `SELECT id, title, metadata FROM key_results WHERE id = $1 LIMIT 1`,
      [kr_id]
    );

    if (goalResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `KR ID ${kr_id} 不存在`
      });
    }

    const goal = goalResult.rows[0];
    const targetCount = parseInt(
      (goal.metadata?.target_pr_count) ||
      (goal.metadata?.custom_props?.target_pr_count) ||
      30,
      10
    );

    // 统计各状态任务数量（只统计 task_type = 'dev' 的任务）
    const statsResult = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_count,
        COUNT(*) FILTER (WHERE status IN ('failed', 'quarantined')) AS failed_count
       FROM tasks
       WHERE goal_id = $1
         AND task_type = 'dev'
         AND created_at >= $2
         AND created_at <= $3`,
      [kr_id, rangeStart.toISOString(), rangeEnd.toISOString()]
    );

    const stats = statsResult.rows[0];
    const completedCount = parseInt(stats.completed_count, 10);
    const inProgressCount = parseInt(stats.in_progress_count, 10);
    const failedCount = parseInt(stats.failed_count, 10);

    // 计算进度百分比（保留 1 位小数）
    const progressPercentage = targetCount > 0
      ? Math.round((completedCount / targetCount) * 1000) / 10
      : 0;

    // 每日完成数量（按 completed_at UTC 日期分组）
    const dailyResult = await pool.query(
      `SELECT
        DATE(completed_at AT TIME ZONE 'UTC') AS date,
        COUNT(*) AS completed
       FROM tasks
       WHERE goal_id = $1
         AND task_type = 'dev'
         AND status = 'completed'
         AND completed_at >= $2
         AND completed_at <= $3
       GROUP BY DATE(completed_at AT TIME ZONE 'UTC')
       ORDER BY date`,
      [kr_id, rangeStart.toISOString(), rangeEnd.toISOString()]
    );

    // 构建每日明细（填充空值为 0）
    const dailyMap = new Map();
    for (const row of dailyResult.rows) {
      const dateStr = row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : String(row.date).slice(0, 10);
      dailyMap.set(dateStr, parseInt(row.completed, 10));
    }

    const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const dailyBreakdown = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      dailyBreakdown.push({ date: dateStr, completed: dailyMap.get(dateStr) || 0 });
    }

    res.json({
      kr_id,
      kr_title: goal.title,
      target_count: targetCount,
      completed_count: completedCount,
      in_progress_count: inProgressCount,
      failed_count: failedCount,
      progress_percentage: progressPercentage,
      time_range: {
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString()
      },
      daily_breakdown: dailyBreakdown,
      last_updated: new Date().toISOString()
    });
  } catch (err) {
    console.error('[API] pr-progress GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/webhook/github
 * GitHub Webhook 接收端点 - 处理 PR 合并事件
 *
 * 验证 X-Hub-Signature-256 header（HMAC SHA-256）。
 * 处理 pull_request 事件（action: closed + merged: true）。
 *
 * 环境变量：
 *   GITHUB_WEBHOOK_SECRET - Webhook secret（必填）
 *
 * 请求 Headers：
 *   X-GitHub-Event: pull_request
 *   X-Hub-Signature-256: sha256=<hex>
 *   Content-Type: application/json
 *
 * 请求体（GitHub pull_request 事件格式）：
 *   {
 *     action: "closed",
 *     pull_request: { merged: true, head: { ref: "cp-xxx" }, ... },
 *     repository: { full_name: "owner/repo" }
 *   }
 */
router.post('/webhook/github', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // 1. Secret 验证（HMAC SHA-256）
    if (!secret) {
      console.error('[webhook/github] GITHUB_WEBHOOK_SECRET 未配置');
      return res.status(500).json({ success: false, error: 'Webhook secret not configured' });
    }

    if (!verifyWebhookSignature(secret, signature, req.body)) {
      console.warn('[webhook/github] 签名验证失败（可能是未授权请求）');
      return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
    }

    // 2. 只处理 pull_request 事件
    if (event !== 'pull_request') {
      return res.status(200).json({ success: true, message: `Event ${event} ignored` });
    }

    // 3. 解析 payload（req.body 是 Buffer，需要 parse）
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch (parseErr) {
      console.error('[webhook/github] Payload 解析失败:', parseErr.message);
      return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
    }

    // 4. 提取 PR 信息（只处理合并事件）
    const prInfo = extractPrInfo(payload);
    if (!prInfo) {
      return res.status(200).json({ success: true, message: 'Not a merged PR event, ignored' });
    }

    console.log(`[webhook/github] PR 合并: repo=${prInfo.repo} pr=#${prInfo.prNumber} branch=${prInfo.branchName}`);

    // 5. 处理任务状态更新
    const result = await handlePrMerged(pool, prInfo);

    if (!result.matched) {
      console.warn(`[webhook/github] 未找到匹配任务: branch=${prInfo.branchName}`);
      return res.status(200).json({
        success: true,
        matched: false,
        message: `No in_progress task found for branch: ${prInfo.branchName}`
      });
    }

    console.log(`[webhook/github] 任务状态已更新: taskId=${result.taskId} krProgress=${result.krProgressUpdated}`);

    return res.status(200).json({
      success: true,
      matched: true,
      taskId: result.taskId,
      taskTitle: result.taskTitle,
      krProgressUpdated: result.krProgressUpdated
    });

  } catch (err) {
    console.error('[webhook/github] 处理失败:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/dev-pipeline/success-rate
 * dev 流水线成功率统计
 *
 * 返回：
 *   window_1h  - 最近 1 小时派发窗口统计（来自 dispatch-stats）
 *   lifetime   - 历史 dev 任务统计（来自 DB）
 */
router.get('/dev-pipeline/success-rate', async (req, res) => {
  try {
    // 1h 窗口统计（dispatch-stats）
    const dispatchStats = await getDispatchStats(pool);

    // 历史统计：dev 任务总数 / 已完成 / 有 PR 合并
    const lifetimeResult = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE pr_merged_at IS NOT NULL) AS with_pr
      FROM tasks
      WHERE task_type = 'dev'
    `);
    const row = lifetimeResult.rows[0];
    const total = parseInt(row.total, 10);
    const completed = parseInt(row.completed, 10);
    const withPr = parseInt(row.with_pr, 10);
    const successRate = total > 0 ? withPr / total : null;

    return res.json({
      window_1h: dispatchStats.window_1h,
      lifetime: {
        total,
        completed,
        with_pr: withPr,
        success_rate: successRate,
      },
    });
  } catch (err) {
    console.error('[API] dev-pipeline/success-rate error:', err.message);
    return res.status(500).json({ error: 'Failed to get dev pipeline success rate', details: err.message });
  }
});

/**
 * GET /api/brain/dev-pipeline/health
 * dev 流水线端到端健康检查
 *
 * 检查每个环节：
 *   task_generator - 最近生成的任务是否有 task_type 字段
 *   executor       - cecelia-run 熔断器状态
 *   pr_callback    - 近期是否有成功的 PR 合并回调
 *   retry          - dev-failure-classifier 是否可正常加载
 */
router.get('/dev-pipeline/health', async (req, res) => {
  const checks = {};
  let allOk = true;

  // 1. task_generator：检查最近 10 个任务是否有 task_type
  try {
    const recentResult = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE task_type IS NOT NULL) AS typed,
             COUNT(*) AS total
      FROM (SELECT task_type FROM tasks ORDER BY created_at DESC LIMIT 10) t
    `);
    const typed = parseInt(recentResult.rows[0].typed, 10);
    const total = parseInt(recentResult.rows[0].total, 10);
    if (total === 0) {
      checks.task_generator = { status: 'warn', detail: 'no tasks found' };
    } else if (typed === 0) {
      checks.task_generator = { status: 'fail', detail: `0/${total} recent tasks have task_type` };
      allOk = false;
    } else if (typed < total) {
      checks.task_generator = { status: 'warn', detail: `${typed}/${total} recent tasks have task_type` };
    } else {
      checks.task_generator = { status: 'ok', detail: `${typed}/${total} recent tasks have task_type` };
    }
  } catch (err) {
    checks.task_generator = { status: 'fail', detail: err.message };
    allOk = false;
  }

  // 2. executor：cecelia-run 熔断器状态
  try {
    const cbState = getAllCBStates();
    const ceceliaRunState = cbState['cecelia-run'];
    if (!ceceliaRunState || ceceliaRunState.state === 'CLOSED') {
      checks.executor = { status: 'ok', detail: ceceliaRunState ? `state=${ceceliaRunState.state}` : 'no circuit breaker (never failed)' };
    } else if (ceceliaRunState.state === 'HALF_OPEN') {
      checks.executor = { status: 'warn', detail: `state=HALF_OPEN failures=${ceceliaRunState.failures}` };
    } else {
      checks.executor = { status: 'fail', detail: `state=OPEN failures=${ceceliaRunState.failures}` };
      allOk = false;
    }
  } catch (err) {
    checks.executor = { status: 'fail', detail: err.message };
    allOk = false;
  }

  // 3. pr_callback：近 7 天内是否有 PR 合并回调
  try {
    const callbackResult = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM tasks
      WHERE pr_merged_at IS NOT NULL
        AND pr_merged_at > NOW() - INTERVAL '7 days'
    `);
    const cnt = parseInt(callbackResult.rows[0].cnt, 10);
    if (cnt > 0) {
      checks.pr_callback = { status: 'ok', detail: `${cnt} PR merges in last 7 days` };
    } else {
      checks.pr_callback = { status: 'warn', detail: 'no PR merges in last 7 days' };
    }
  } catch (err) {
    checks.pr_callback = { status: 'fail', detail: err.message };
    allOk = false;
  }

  // 4. retry：dev-failure-classifier 是否可正常加载
  try {
    const mod = await import('../dev-failure-classifier.js');
    if (typeof mod.classifyDevFailure === 'function') {
      checks.retry = { status: 'ok', detail: 'dev-failure-classifier loaded' };
    } else {
      checks.retry = { status: 'fail', detail: 'classifyDevFailure not exported' };
      allOk = false;
    }
  } catch (err) {
    checks.retry = { status: 'fail', detail: err.message };
    allOk = false;
  }

  return res.json({ healthy: allOk, checks });
});

// ─────────────────────────────────────────────────────────────
// Instruction Book API
// GET /api/brain/docs/instruction-book
// 读取 docs/instruction-book/ 目录，返回结构化条目列表
// ─────────────────────────────────────────────────────────────
router.get('/docs/instruction-book', async (req, res) => {
  try {
    const { readdirSync: rds, readFileSync: rfs } = await import('fs');
    const { fileURLToPath } = await import('url');
    const pathMod = await import('path');

    const docsRoot = pathMod.default.join(
      pathMod.default.dirname(fileURLToPath(import.meta.url)),
      '../../../docs/instruction-book'
    );

    function parseEntry(filePath, category) {
      const raw = rfs(filePath, 'utf-8');
      const lines = raw.split('\n');

      // 提取 frontmatter id/version/changelog
      let id = '', version = '';
      const changelog = [];
      let inFrontmatter = false;
      let frontmatterDone = false;
      let inChangelogBlock = false;
      for (const line of lines) {
        if (line.trim() === '---') {
          if (!frontmatterDone) { inFrontmatter = !inFrontmatter; if (!inFrontmatter) frontmatterDone = true; }
          continue;
        }
        if (inFrontmatter) {
          if (line.match(/^changelog:\s*$/)) { inChangelogBlock = true; continue; }
          if (inChangelogBlock) {
            const item = line.match(/^\s+-\s+(.+)/);
            if (item) {
              const verDesc = item[1].match(/^(\d[\d.]+):\s*(.+)/);
              if (verDesc) changelog.push({ version: verDesc[1], description: verDesc[2].trim() });
              else changelog.push({ version: '', description: item[1].trim() });
            } else if (line.match(/^\S/)) {
              inChangelogBlock = false;
            }
          }
          if (!inChangelogBlock) {
            const m = line.match(/^(id|version):\s*(.+)/);
            if (m) { if (m[1] === 'id') id = m[2].trim(); else version = m[2].trim(); }
          }
        }
      }

      // 提取标题（第一个 # 行）
      const titleLine = lines.find(l => l.startsWith('# ') && !l.startsWith('## '));
      const title = titleLine ? titleLine.replace(/^# /, '').trim() : pathMod.default.basename(filePath, '.md');

      // 提取各章节内容（支持 ### 子章节）
      const sections = {};
      const subSections = {};
      let currentSection = null;
      let sectionLines = [];
      let currentSubSection = null;
      let subSectionLines = [];
      const sectionMap = {
        'What it is': 'what',
        'What': 'what',
        'Trigger': 'trigger',
        'How to use': 'howToUse',
        'Output': 'output',
        'Added in': 'addedIn',
      };

      function flushSubSection() {
        if (currentSection && currentSubSection !== null) {
          if (!subSections[currentSection]) subSections[currentSection] = [];
          subSections[currentSection].push({ title: currentSubSection, content: subSectionLines.join('\n').trim() });
        }
        currentSubSection = null;
        subSectionLines = [];
      }

      for (const line of lines) {
        if (line.startsWith('## ')) {
          flushSubSection();
          if (currentSection) sections[currentSection] = sectionLines.join('\n').trim();
          const header = line.replace(/^## /, '').trim();
          currentSection = sectionMap[header] || null;
          sectionLines = [];
        } else if (line.startsWith('### ') && currentSection) {
          flushSubSection();
          currentSubSection = line.replace(/^### /, '').trim();
        } else if (currentSection) {
          if (currentSubSection !== null) subSectionLines.push(line);
          else sectionLines.push(line);
        }
      }
      flushSubSection();
      if (currentSection) sections[currentSection] = sectionLines.join('\n').trim();

      // 将子章节合并到 sections
      const sectionsWithSub = {};
      for (const [key, content] of Object.entries(sections)) {
        sectionsWithSub[key] = { content, subsections: subSections[key] || [] };
      }

      return { id, version, changelog, title, category, sections: sectionsWithSub };
    }

    function readCategory(subDir, categoryName) {
      const dir = pathMod.default.join(docsRoot, subDir);
      try {
        return rds(dir)
          .filter(f => f.endsWith('.md'))
          .map(f => parseEntry(pathMod.default.join(dir, f), categoryName));
      } catch {
        return [];
      }
    }

    const skills = readCategory('skills', 'skill');
    const features = readCategory('features', 'feature');

    res.json({ skills, features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deploy Webhook ──────────────────────────────────────────────────────────

// In-memory deploy state tracker（进程重启后重置为 idle，属预期行为）
export const deployState = {
  status: 'idle',       // idle | running | success | failed
  version: null,
  started_at: null,
  finished_at: null,
  elapsed_ms: null,
  error: null,
};

// GET /api/brain/deploy/status — 查询最近一次部署状态
router.get('/deploy/status', (req, res) => {
  res.json({ ...deployState });
});

// POST /api/brain/deploy — GitHub Actions 合并后触发本地部署
router.post('/deploy', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const expectedToken = process.env.DEPLOY_TOKEN;

  if (!expectedToken) {
    return res.status(500).json({ error: 'DEPLOY_TOKEN not configured on server' });
  }
  if (!token || token !== expectedToken) {
    return res.status(401).json({ error: 'Invalid or missing deploy token' });
  }

  const { changed_paths } = req.body || {};

  // 更新状态为 running，立即返回 202
  deployState.status = 'running';
  deployState.started_at = new Date().toISOString();
  deployState.finished_at = null;
  deployState.elapsed_ms = null;
  deployState.error = null;

  res.status(202).json({ status: 'accepted', message: 'Deploy triggered' });

  const { execSync } = await import('child_process');
  const startTime = Date.now();

  try {
    // 构建 deploy-local.sh 参数
    const scriptDir = new URL('../../../../scripts/deploy-local.sh', import.meta.url).pathname;
    let cmd = `bash "${scriptDir}" main`;

    if (changed_paths && changed_paths.length > 0) {
      const escaped = changed_paths.join(' ').replace(/"/g, '\\"');
      cmd = `bash "${scriptDir}" --changed="${escaped}" main`;
    }

    console.log(`[deploy-webhook] 开始部署: ${cmd}`);
    execSync(cmd, {
      cwd: new URL('../../../..', import.meta.url).pathname,
      timeout: 600_000, // 10 分钟超时
      stdio: 'inherit',
    });

    const elapsed = Date.now() - startTime;
    deployState.status = 'success';
    deployState.finished_at = new Date().toISOString();
    deployState.elapsed_ms = elapsed;
    console.log(`[deploy-webhook] ✅ 部署成功 (${(elapsed / 1000).toFixed(1)}s)`);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    deployState.status = 'failed';
    deployState.finished_at = new Date().toISOString();
    deployState.elapsed_ms = elapsed;
    deployState.error = err.message;
    console.error(`[deploy-webhook] ❌ 部署失败 (${(elapsed / 1000).toFixed(1)}s):`, err.message);
  }
});


export default router;
