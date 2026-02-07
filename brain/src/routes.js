 
import { Router } from 'express';
// Inlined from deleted orchestrator.js / perception.js (1/31 migration remnants replaced by three-layer brain)
async function getActivePolicy() {
  const result = await pool.query(`SELECT id, version, name, content_json FROM policy WHERE active = true ORDER BY version DESC LIMIT 1`);
  return result.rows[0] || null;
}
async function getWorkingMemory() {
  const result = await pool.query(`SELECT key, value_json FROM working_memory`);
  const memory = {};
  for (const row of result.rows) memory[row.key] = row.value_json;
  return memory;
}
async function getTopTasks(limit = 10) {
  const result = await pool.query(`SELECT id, title, description, priority, status, project_id, queued_at, updated_at, due_at FROM tasks WHERE status NOT IN ('completed', 'cancelled') ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC LIMIT $1`, [limit]);
  return result.rows;
}
async function getRecentDecisions(limit = 10) {
  const result = await pool.query(`SELECT id, ts, trigger, input_summary, llm_output_json, action_result_json, status FROM decision_log ORDER BY ts DESC LIMIT $1`, [limit]);
  return result.rows;
}
async function getLatestSnapshot() {
  const result = await pool.query(`SELECT id, ts, source, snapshot_json FROM system_snapshot ORDER BY ts DESC LIMIT 1`);
  return result.rows[0] || null;
}
import { createTask, updateTask, createGoal, updateGoal, triggerN8n, setMemory, batchUpdateTasks } from './actions.js';
import { getDailyFocus, setDailyFocus, clearDailyFocus, getFocusSummary } from './focus.js';
import { getTickStatus, enableTick, disableTick, executeTick, runTickSafe, routeTask, startFeatureTickLoop, stopFeatureTickLoop, getFeatureTickStatus, TASK_TYPE_AGENT_MAP } from './tick.js';
import {
  createFeature, getFeature, getFeaturesByStatus, updateFeature,
  createFeatureTask, handleFeatureTaskComplete, FEATURE_STATUS
} from './feature-tick.js';
import { identifyWorkType, getTaskLocation, routeTaskCreate, getValidTaskTypes, LOCATION_MAP } from './task-router.js';
import { checkAntiCrossing, validateTaskCompletion, getActiveFeaturesWithTasks } from './anti-crossing.js';
import {
  executeOkrTick, runOkrTickSafe, startOkrTickLoop, stopOkrTickLoop, getOkrTickStatus,
  addQuestionToGoal, answerQuestionForGoal, getPendingQuestions, OKR_STATUS
} from './okr-tick.js';
import {
  executeNightlyAlignment, runNightlyAlignmentSafe, startNightlyScheduler, stopNightlyScheduler,
  getNightlyTickStatus, getDailyReports
} from './nightly-tick.js';
import { parseIntent, parseAndCreate, INTENT_TYPES, INTENT_ACTION_MAP, extractEntities, classifyIntent, getSuggestedAction } from './intent.js';
import pool from './db.js';
import { generatePrdFromTask, generatePrdFromGoalKR, generateTrdFromGoal, generateTrdFromGoalKR, validatePrd, validateTrd, prdToJson, trdToJson, PRD_TYPE_MAP } from './templates.js';
import { compareGoalProgress, generateDecision, executeDecision, getDecisionHistory, rollbackDecision } from './decision.js';
import { planNextTask, getPlanStatus, handlePlanInput } from './planner.js';
import { ensureEventsTable, queryEvents, getEventCounts } from './event-bus.js';
import { getState as getCBState, reset as resetCB, getAllStates as getAllCBStates } from './circuit-breaker.js';
import { getAlertness, getDecayStatus, setManualOverride, clearManualOverride, evaluateAndUpdate as evaluateAlertness, ALERTNESS_LEVELS, LEVEL_NAMES, EVENT_BACKLOG_THRESHOLD, RECOVERY_THRESHOLDS } from './alertness.js';
import { handleTaskFailure, getQuarantinedTasks, getQuarantineStats, releaseTask, quarantineTask, QUARANTINE_REASONS, REVIEW_ACTIONS, classifyFailure, FAILURE_CLASS } from './quarantine.js';
import { publishTaskCreated, publishTaskCompleted, publishTaskFailed } from './events/taskEvents.js';
import { emit as emitEvent } from './event-bus.js';
import { recordSuccess as cbSuccess, recordFailure as cbFailure } from './circuit-breaker.js';
import { notifyTaskCompleted, notifyTaskFailed } from './notifier.js';
import websocketService from './websocket.js';
import crypto from 'crypto';
import { processEvent as thalamusProcessEvent, EVENT_TYPES, LLM_ERROR_TYPE } from './thalamus.js';
import { executeDecision as executeThalamusDecision, getPendingActions, approvePendingAction, rejectPendingAction } from './decision-executor.js';
import { createProposal, approveProposal, rollbackProposal, rejectProposal, getProposal, listProposals } from './proposal.js';

const router = Router();

// ==================== 白名单配置 ====================

const ALLOWED_ACTIONS = {
  'create-task': {
    required: ['title'],
    optional: ['description', 'priority', 'project_id', 'goal_id', 'tags', 'task_type', 'context']
  },
  'update-task': {
    required: ['task_id'],
    optional: ['status', 'priority']
  },
  'batch-update-tasks': {
    required: ['filter', 'update'],
    optional: []
  },
  'create-goal': {
    required: ['title'],
    optional: ['description', 'priority', 'project_id', 'target_date', 'parent_id']
  },
  'update-goal': {
    required: ['goal_id'],
    optional: ['status', 'progress']
  },
  'set-memory': {
    required: ['key', 'value'],
    optional: []
  },
  'trigger-n8n': {
    required: ['webhook_path'],
    optional: ['data']
  }
};

// ==================== 幂等性检查 ====================

const processedKeys = new Map(); // 内存缓存，生产环境应用 Redis
const IDEMPOTENCY_TTL = 5 * 60 * 1000; // 5 分钟

function checkIdempotency(key) {
  if (!key) return { isDuplicate: false };

  const now = Date.now();
  const existing = processedKeys.get(key);

  if (existing && (now - existing.timestamp) < IDEMPOTENCY_TTL) {
    return { isDuplicate: true, previousResult: existing.result };
  }

  return { isDuplicate: false };
}

function saveIdempotency(key, result) {
  if (!key) return;
  processedKeys.set(key, { timestamp: Date.now(), result });

  // 清理过期的 key
  for (const [k, v] of processedKeys.entries()) {
    if (Date.now() - v.timestamp > IDEMPOTENCY_TTL) {
      processedKeys.delete(k);
    }
  }
}

// ==================== 内部决策日志 ====================

async function internalLogDecision(trigger, inputSummary, decision, result) {
  await pool.query(`
    INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [
    trigger || 'orchestrator',
    inputSummary || '',
    decision || {},
    result || {},
    result?.success ? 'success' : 'failed'
  ]);
}

// ==================== 状态读取 API ====================

// Decision Pack 版本
const PACK_VERSION = '2.1.0';
const DEFAULT_TTL_SECONDS = 300; // 5 分钟

/**
 * GET /api/brain/status
 * 精简决策包（给 LLM/皮层用）
 * 固定 schema，可控裁剪
 */
router.get('/status', async (req, res) => {
  try {
    // 支持 ?mode=interactive|scheduled|incident
    const decisionMode = req.query.mode || 'interactive';

    const [policy, workingMemory, topTasks, recentDecisions, snapshot, dailyFocus] = await Promise.all([
      getActivePolicy(),
      getWorkingMemory(),
      getTopTasks(10),
      getRecentDecisions(5),
      getLatestSnapshot(),
      getFocusSummary()
    ]);

    const now = new Date();

    // 精简决策包 - 固定 schema v2.0.0
    const decisionPack = {
      // === 包元数据 ===
      pack_version: PACK_VERSION,
      generated_at: now.toISOString(),
      ttl_seconds: DEFAULT_TTL_SECONDS,
      decision_mode: decisionMode,

      // === 今日焦点 ===
      daily_focus: dailyFocus,

      // === 动作约束（幂等、安全闸门）===
      action_constraints: {
        require_idempotency_key: true,
        idempotency_ttl_seconds: IDEMPOTENCY_TTL / 1000,
        max_actions_per_turn: decisionMode === 'scheduled' ? 1 : 3,
        allowed_actions: Object.keys(ALLOWED_ACTIONS),
        scheduled_forbidden: decisionMode === 'scheduled' ? ['create-task', 'create-goal'] : []
      },

      // === 策略版本 ===
      policy_version: policy?.version || 0,
      policy_rules: {
        priority_order: policy?.content_json?.priority_order || ['P0', 'P1', 'P2'],
        confidence_threshold: policy?.content_json?.confidence_threshold || 0.6
      },

      // === 工作记忆（只取关键 key）===
      memory: {
        current_focus: workingMemory.current_focus || null,
        today_intent: workingMemory.today_intent || null,
        blocked_by: workingMemory.blocked_by || { items: [] }
      },

      // === 最近决策摘要（5 条，带 action 名）===
      recent_decisions: recentDecisions.map(d => ({
        ts: d.ts,
        action: d.llm_output_json?.action || d.llm_output_json?.next_action || 'unknown',
        trigger: d.trigger || 'unknown',
        status: d.status,
        duplicate: d.action_result_json?.duplicate || false
      })),

      // === 系统健康摘要（可量化）===
      system_health: snapshot?.snapshot_json ? {
        n8n_ok: snapshot.snapshot_json.n8n?.status === 'ok',
        n8n_failures_1h: snapshot.snapshot_json.n8n?.failures_1h || 0,
        n8n_active_workflows: snapshot.snapshot_json.n8n?.active_workflows || 0,
        n8n_executions_1h: snapshot.snapshot_json.n8n?.executions_1h || 0,
        task_system_ok: snapshot.snapshot_json.task_system?.status === 'ok',
        open_tasks_total: (snapshot.snapshot_json.task_system?.open_p0 || 0) +
                          (snapshot.snapshot_json.task_system?.open_p1 || 0),
        stale_tasks: snapshot.snapshot_json.task_system?.stale_count || 0
      } : {
        n8n_ok: false,
        n8n_failures_1h: 0,
        task_system_ok: false,
        open_tasks_total: 0,
        stale_tasks: 0
      },
      snapshot_ts: snapshot?.ts || null,

      // === 任务摘要（P0 top5 + P1 top5，带关键字段）===
      task_digest: {
        p0: topTasks
          .filter(t => t.priority === 'P0')
          .slice(0, 5)
          .map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            updated_at: t.updated_at,
            due_at: t.due_at || null
          })),
        p1: topTasks
          .filter(t => t.priority === 'P1')
          .slice(0, 5)
          .map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            updated_at: t.updated_at,
            due_at: t.due_at || null
          })),
        stats: {
          open_p0: topTasks.filter(t => t.priority === 'P0' && t.status !== 'completed').length,
          open_p1: topTasks.filter(t => t.priority === 'P1' && t.status !== 'completed').length,
          in_progress: topTasks.filter(t => t.status === 'in_progress').length,
          queued: topTasks.filter(t => t.status === 'queued').length,
          overdue: topTasks.filter(t => t.due_at && new Date(t.due_at) < now && t.status !== 'completed').length
        }
      }
    };

    res.json(decisionPack);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status', details: err.message });
  }
});

/**
 * GET /api/brain/status/ws
 * WebSocket 服务状态
 */
router.get('/status/ws', (req, res) => {
  res.json({
    success: true,
    websocket: {
      active: websocketService.wss !== null,
      connected_clients: websocketService.getClientCount(),
      endpoint: '/ws'
    }
  });
});

/**
 * GET /api/brain/status/full
 * 完整状态（给人 debug 用）— 使用 inlined helpers
 */
router.get('/status/full', async (req, res) => {
  try {
    const [snapshot, workingMemory, topTasks, recentDecisionsData, policy] = await Promise.all([
      getLatestSnapshot(),
      getWorkingMemory(),
      getTopTasks(10),
      getRecentDecisions(3),
      getActivePolicy()
    ]);
    res.json({
      snapshot: snapshot?.snapshot_json || null,
      snapshot_ts: snapshot?.ts || null,
      working_memory: workingMemory,
      top_tasks: topTasks,
      recent_decisions: recentDecisionsData.map(d => ({
        ts: d.ts, trigger: d.trigger, input: d.input_summary,
        action: d.llm_output_json?.next_action, status: d.status
      })),
      policy: policy?.content_json || {},
      stats: {
        open_p0: topTasks.filter(t => t.priority === 'P0' && t.status !== 'completed').length,
        open_p1: topTasks.filter(t => t.priority === 'P1' && t.status !== 'completed').length,
        in_progress: topTasks.filter(t => t.status === 'in_progress').length,
        queued: topTasks.filter(t => t.status === 'queued').length
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get full status', details: err.message });
  }
});

/**
 * GET /api/brain/memory
 */
router.get('/memory', async (req, res) => {
  try {
    const memory = await getWorkingMemory();
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get memory', details: err.message });
  }
});

/**
 * GET /api/brain/policy
 */
router.get('/policy', async (req, res) => {
  try {
    const policy = await getActivePolicy();
    if (policy) {
      res.json(policy);
    } else {
      res.status(404).json({ error: 'No active policy found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to get policy', details: err.message });
  }
});

/**
 * GET /api/brain/decisions
 * 历史决策记录（只读，审计用）
 */
router.get('/decisions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const decisions = await getRecentDecisions(limit);
    res.json(decisions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get decisions', details: err.message });
  }
});

/**
 * GET /api/brain/tasks
 */
router.get('/tasks', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const { status, task_type } = req.query;

    // If filters provided, use custom query instead of getTopTasks
    if (status || task_type) {
      let query = 'SELECT * FROM tasks WHERE 1=1';
      const params = [];
      let paramIndex = 1;

      if (status) {
        query += ` AND status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (task_type) {
        query += ` AND task_type = $${paramIndex}`;
        params.push(task_type);
        paramIndex++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await pool.query(query, params);
      return res.json(result.rows);
    }

    // Default behavior: use getTopTasks
    const tasks = await getTopTasks(limit);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get tasks', details: err.message });
  }
});

// ==================== Focus API（优先级引擎） ====================

/**
 * GET /api/brain/focus
 * 获取今日焦点
 */
router.get('/focus', async (req, res) => {
  try {
    const focus = await getDailyFocus();
    if (focus) {
      res.json(focus);
    } else {
      res.json({ focus: null, reason: '没有活跃的 Objective' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to get focus', details: err.message });
  }
});

/**
 * POST /api/brain/focus/set
 * 手动设置今日焦点（覆盖算法选择）
 */
router.post('/focus/set', async (req, res) => {
  try {
    const { objective_id } = req.body;

    if (!objective_id) {
      return res.status(400).json({ error: 'objective_id is required' });
    }

    const result = await setDailyFocus(objective_id);
    res.json(result);
  } catch (err) {
    if (err.message === 'Objective not found') {
      res.status(404).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Failed to set focus', details: err.message });
    }
  }
});

/**
 * POST /api/brain/focus/clear
 * 清除手动设置，恢复自动选择
 */
router.post('/focus/clear', async (req, res) => {
  try {
    const result = await clearDailyFocus();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear focus', details: err.message });
  }
});

// ==================== Tick API（Action Loop）====================

/**
 * POST /api/brain/tick
 * 手动触发一次 tick
 */
router.post('/tick', async (req, res) => {
  try {
    const result = await runTickSafe('manual');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute tick', details: err.message });
  }
});

/**
 * GET /api/brain/tick/status
 * 获取 tick 状态
 */
router.get('/tick/status', async (req, res) => {
  try {
    const status = await getTickStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get tick status', details: err.message });
  }
});

/**
 * POST /api/brain/tick/enable
 * 启用自动 tick
 */
router.post('/tick/enable', async (req, res) => {
  try {
    const result = await enableTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to enable tick', details: err.message });
  }
});

/**
 * POST /api/brain/tick/disable
 * 禁用自动 tick
 */
router.post('/tick/disable', async (req, res) => {
  try {
    const result = await disableTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable tick', details: err.message });
  }
});

// ==================== Alertness API ====================

/**
 * GET /api/brain/alertness
 * 获取当前警觉级别和状态
 */
router.get('/alertness', async (req, res) => {
  try {
    const alertness = getAlertness();
    res.json({
      success: true,
      ...alertness,
      levels: ALERTNESS_LEVELS,
      level_names: LEVEL_NAMES
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get alertness', details: err.message });
  }
});

/**
 * POST /api/brain/alertness/evaluate
 * 重新评估警觉级别
 */
router.post('/alertness/evaluate', async (req, res) => {
  try {
    const result = await evaluateAlertness();
    res.json({
      success: true,
      ...result,
      level_name: LEVEL_NAMES[result.level]
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to evaluate alertness', details: err.message });
  }
});

/**
 * POST /api/brain/alertness/override
 * 手动覆盖警觉级别
 * Body: { level: 0-3, reason: "string", duration_minutes?: 30 }
 */
router.post('/alertness/override', async (req, res) => {
  try {
    const { level, reason, duration_minutes = 30 } = req.body;

    if (level === undefined || level < 0 || level > 3) {
      return res.status(400).json({ error: 'level must be 0-3' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'reason is required' });
    }

    const durationMs = duration_minutes * 60 * 1000;
    const result = await setManualOverride(level, reason, durationMs);

    res.json({
      success: true,
      level,
      level_name: LEVEL_NAMES[level],
      reason,
      duration_minutes,
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set override', details: err.message });
  }
});

/**
 * POST /api/brain/alertness/clear-override
 * 清除手动覆盖
 */
router.post('/alertness/clear-override', async (req, res) => {
  try {
    const result = await clearManualOverride();
    const alertness = getAlertness();
    res.json({
      success: result.success,
      current_level: alertness.level,
      current_level_name: LEVEL_NAMES[alertness.level],
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear override', details: err.message });
  }
});

// ==================== Quarantine API ====================

/**
 * GET /api/brain/quarantine
 * 获取隔离区中的任务列表
 */
router.get('/quarantine', async (req, res) => {
  try {
    const tasks = await getQuarantinedTasks();
    const stats = await getQuarantineStats();
    res.json({
      success: true,
      stats,
      tasks,
      reasons: QUARANTINE_REASONS,
      actions: REVIEW_ACTIONS
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get quarantine', details: err.message });
  }
});

/**
 * GET /api/brain/quarantine/stats
 * 获取隔离区统计
 */
router.get('/quarantine/stats', async (req, res) => {
  try {
    const stats = await getQuarantineStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats', details: err.message });
  }
});

/**
 * POST /api/brain/quarantine/:taskId/release
 * 释放任务从隔离区
 * Body: { action: "release"|"retry_once"|"cancel"|"modify", reason?: string, new_prd?: string }
 */
router.post('/quarantine/:taskId/release', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { action, reason, new_prd, reviewer } = req.body;

    if (!action || !REVIEW_ACTIONS[action.toUpperCase()]) {
      return res.status(400).json({
        error: 'Invalid action',
        valid_actions: Object.keys(REVIEW_ACTIONS)
      });
    }

    const result = await releaseTask(taskId, action, {
      reason,
      new_prd,
      reviewer: reviewer || 'api'
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to release task', details: err.message });
  }
});

/**
 * POST /api/brain/quarantine/:taskId
 * 手动隔离任务
 * Body: { reason?: string, details?: object }
 */
router.post('/quarantine/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { reason, details } = req.body;

    const result = await quarantineTask(
      taskId,
      reason || QUARANTINE_REASONS.MANUAL,
      details || { manual: true, reviewer: 'api' }
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to quarantine task', details: err.message });
  }
});

/**
 * POST /api/brain/quarantine/release-all
 * 批量释放所有隔离任务（谨慎使用）
 * Body: { action: "release"|"cancel", confirm: true }
 */
router.post('/quarantine/release-all', async (req, res) => {
  try {
    const { action, confirm } = req.body;

    if (!confirm) {
      return res.status(400).json({ error: 'Must set confirm: true to release all' });
    }

    if (!action || !['release', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'action must be "release" or "cancel"' });
    }

    const tasks = await getQuarantinedTasks();
    const results = [];

    for (const task of tasks) {
      const result = await releaseTask(task.id, action, { reviewer: 'batch-api' });
      results.push({ task_id: task.id, ...result });
    }

    res.json({
      success: true,
      action,
      processed: results.length,
      results
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to release all', details: err.message });
  }
});

// ==================== Watchdog API ====================

/**
 * GET /api/brain/watchdog
 * 资源看门狗诊断 - 每个任务的实时 RSS/CPU/采样数/阈值
 */
router.get('/watchdog', async (req, res) => {
  try {
    const { getWatchdogStatus } = await import('./watchdog.js');
    const status = getWatchdogStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get watchdog status', details: err.message });
  }
});

// ==================== Token Usage API ====================

/**
 * GET /api/brain/token-usage
 * Token 消耗统计（今日 / 本周 / 本月 / 按 source 分组）
 */
router.get('/token-usage', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        source,
        payload->>'model' as model,
        COUNT(*) as calls,
        SUM((payload->>'input_tokens')::int) as input_tokens,
        SUM((payload->>'output_tokens')::int) as output_tokens,
        SUM((payload->>'total_tokens')::int) as total_tokens,
        ROUND(SUM((payload->>'cost_usd')::numeric)::numeric, 4) as cost_usd
      FROM cecelia_events
      WHERE event_type = 'token_usage'
        AND created_at >= CURRENT_DATE
      GROUP BY source, payload->>'model'
      ORDER BY cost_usd DESC
    `);

    const totalToday = result.rows.reduce((s, r) => s + parseFloat(r.cost_usd || 0), 0);

    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      total_cost_usd: Math.round(totalToday * 10000) / 10000,
      breakdown: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get token usage', details: err.message });
  }
});

// ==================== Pending Actions API（危险动作审批） ====================

/**
 * GET /api/brain/pending-actions
 * 获取待审批动作列表
 */
router.get('/pending-actions', async (req, res) => {
  try {
    const actions = await getPendingActions();
    res.json({ success: true, count: actions.length, actions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get pending actions', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions/:id/approve
 * 批准并执行待审批动作
 * Body: { reviewer?: string }
 */
router.post('/pending-actions/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer } = req.body || {};

    const result = await approvePendingAction(id, reviewer || 'api-user');

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve action', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions/:id/reject
 * 拒绝待审批动作
 * Body: { reviewer?: string, reason?: string }
 */
router.post('/pending-actions/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer, reason } = req.body || {};

    const result = await rejectPendingAction(id, reviewer || 'api-user', reason || '');

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject action', details: err.message });
  }
});

// ==================== 动作执行 API（白名单 + 幂等） ====================

// POST /api/brain/snapshot — removed (perception.js deleted, createSnapshot no longer available)

/**
 * 通用 Action 处理器
 * 白名单检查 + 幂等性 + 自动记录决策
 */
async function handleAction(actionName, params, idempotencyKey, trigger = 'api') {
  // 1. 白名单检查
  const schema = ALLOWED_ACTIONS[actionName];
  if (!schema) {
    return { success: false, error: `Action '${actionName}' not allowed` };
  }

  // 2. 必填参数检查
  for (const field of schema.required) {
    if (params[field] === undefined) {
      return { success: false, error: `Missing required field: ${field}` };
    }
  }

  // 3. 幂等性检查
  const idempotency = checkIdempotency(idempotencyKey);
  if (idempotency.isDuplicate) {
    return { success: true, duplicate: true, previousResult: idempotency.previousResult };
  }

  // 4. 执行动作
  let result;
  try {
    switch (actionName) {
      case 'create-task':
        result = await createTask(params);
        break;
      case 'update-task':
        result = await updateTask(params);
        break;
      case 'batch-update-tasks':
        result = await batchUpdateTasks(params);
        break;
      case 'create-goal':
        result = await createGoal(params);
        break;
      case 'update-goal':
        result = await updateGoal(params);
        break;
      case 'set-memory':
        result = await setMemory(params);
        break;
      case 'trigger-n8n':
        result = await triggerN8n(params);
        break;
      default:
        result = { success: false, error: 'Unknown action' };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  // 5. 保存幂等键
  saveIdempotency(idempotencyKey, result);

  // 6. 记录决策日志（内部自动记录）
  await internalLogDecision(trigger, `Action: ${actionName}`, { action: actionName, params }, result);

  return result;
}

/**
 * POST /api/brain/action/:actionName
 * 统一 Action 入口
 */
router.post('/action/:actionName', async (req, res) => {
  try {
    const { actionName } = req.params;
    const { idempotency_key, trigger, ...params } = req.body;

    // 生成幂等键（如果没提供）
    const key = idempotency_key || `${actionName}-${crypto.randomUUID()}`;

    const result = await handleAction(actionName, params, key, trigger || 'api');

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(500).json({ error: 'Action failed', details: err.message });
  }
});

// 保留原有的快捷路由（内部调用统一处理器）
router.post('/action/create-task', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `create-task-${params.title}-${Date.now()}`;
  const result = await handleAction('create-task', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

/**
 * POST /api/brain/action/create-feature
 * Create a Feature (写入 projects 表，parent_id 指向 Project)
 * 秋米专用：拆解 KR 时创建 Feature
 */
router.post('/action/create-feature', async (req, res) => {
  try {
    const { name, parent_id, kr_id, decomposition_mode, description } = req.body;

    if (!name || !parent_id) {
      return res.status(400).json({
        success: false,
        error: 'name and parent_id are required'
      });
    }

    const { createFeature: createFeatureAction } = await import('./actions.js');
    const result = await createFeatureAction({
      name,
      parent_id,
      kr_id,
      decomposition_mode: decomposition_mode || 'known',
      description
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to create feature',
      details: err.message
    });
  }
});

router.post('/action/update-task', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `update-task-${params.task_id}-${params.status || params.priority}`;
  const result = await handleAction('update-task', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/batch-update-tasks', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `batch-${JSON.stringify(params.filter)}-${Date.now()}`;
  const result = await handleAction('batch-update-tasks', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/create-goal', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `create-goal-${params.title}-${Date.now()}`;
  const result = await handleAction('create-goal', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/update-goal', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `update-goal-${params.goal_id}-${params.status || params.progress}`;
  const result = await handleAction('update-goal', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/set-memory', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `set-memory-${params.key}`;
  const result = await handleAction('set-memory', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

router.post('/action/trigger-n8n', async (req, res) => {
  const { idempotency_key, trigger, ...params } = req.body;
  const key = idempotency_key || `trigger-n8n-${params.webhook_path}-${Date.now()}`;
  const result = await handleAction('trigger-n8n', params, key, trigger);
  res.status(result.success ? 200 : 400).json(result);
});

// 注意：log-decision 不再对外暴露，由 handleAction 内部自动记录

// ==================== Query Status Handler ====================

/**
 * Execute a query_status intent by fetching relevant data
 */
async function executeQueryStatus(parsedIntent) {
  const entities = parsedIntent.entities || {};
  const result = { handler: 'queryStatus', data: {} };

  if (entities.module || entities.feature) {
    const searchTerm = entities.module || entities.feature;
    const tasks = await pool.query(`
      SELECT id, title, status, priority, updated_at
      FROM tasks
      WHERE title ILIKE $1 OR description ILIKE $1
      ORDER BY priority ASC, updated_at DESC
      LIMIT 20
    `, [`%${searchTerm}%`]);
    result.data.tasks = tasks.rows;
    result.data.query = `Tasks matching "${searchTerm}"`;
  } else {
    const [tasks, goals] = await Promise.all([
      pool.query(`
        SELECT id, title, status, priority, updated_at
        FROM tasks
        WHERE status NOT IN ('completed', 'cancelled')
        ORDER BY priority ASC, updated_at DESC
        LIMIT 20
      `),
      pool.query(`
        SELECT id, title, status, priority, progress
        FROM goals
        WHERE status NOT IN ('completed', 'cancelled')
        ORDER BY priority ASC
        LIMIT 10
      `)
    ]);
    result.data.tasks = tasks.rows;
    result.data.goals = goals.rows;
    result.data.summary = {
      open_tasks: tasks.rows.length,
      active_goals: goals.rows.length
    };
    result.data.query = 'General status overview';
  }

  return result;
}

// ==================== Intent API（KR1 意图识别）====================

/**
 * POST /api/brain/intent/parse
 * Parse natural language input and return structured intent
 *
 * Request body:
 *   { input: "我想做一个 GMV Dashboard" }
 *
 * Response:
 *   {
 *     success: true,
 *     parsed: {
 *       originalInput: "...",
 *       intentType: "create_project",
 *       confidence: 0.8,
 *       keywords: ["做一个"],
 *       projectName: "gmv-dashboard",
 *       tasks: [...],
 *       prdDraft: "..."
 *     }
 *   }
 */
router.post('/intent/parse', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const parsed = await parseIntent(input);

    res.json({
      success: true,
      parsed,
      intent_types: INTENT_TYPES
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to parse intent',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/intent/create
 * Parse intent and create resources (project, tasks) in database
 *
 * Request body:
 *   {
 *     input: "我想做一个 GMV Dashboard",
 *     options: {
 *       createProject: true,
 *       createTasks: true,
 *       goalId: null,
 *       projectId: null
 *     }
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     parsed: {...},
 *     created: {
 *       project: {...},
 *       tasks: [...]
 *     }
 *   }
 */
router.post('/intent/create', async (req, res) => {
  try {
    const { input, options = {} } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const result = await parseAndCreate(input, options);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to parse and create',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/intent/types
 * Get available intent types
 */
router.get('/intent/types', (req, res) => {
  res.json({
    success: true,
    types: INTENT_TYPES,
    description: {
      create_project: '创建新项目（如：我想做一个 GMV Dashboard）',
      create_feature: '添加新功能（如：给登录页面加一个忘记密码功能）',
      create_goal: '创建目标（如：创建一个 P0 目标：提升系统稳定性）',
      create_task: '创建任务（如：添加一个任务：修复登录超时）',
      query_status: '查询状态（如：当前有哪些任务？）',
      fix_bug: '修复 Bug（如：修复购物车页面的价格显示问题）',
      refactor: '重构代码（如：重构用户模块的代码结构）',
      explore: '探索/调研（如：帮我看看这个 API 怎么用）',
      question: '提问（如：为什么这里会报错？）',
      unknown: '无法识别的意图'
    },
    action_map: INTENT_ACTION_MAP
  });
});

/**
 * POST /api/brain/intent/execute
 * Parse intent and automatically execute the mapped brain action
 *
 * Request body:
 *   { input: "创建一个 P0 目标：提升系统稳定性", dry_run: false }
 *
 * Response:
 *   {
 *     success: true,
 *     parsed: { intentType, confidence, suggestedAction, ... },
 *     executed: { action: "create-goal", result: {...} }
 *   }
 */
router.post('/intent/execute', async (req, res) => {
  try {
    const { input, dry_run = false, confidence_threshold } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const parsed = await parseIntent(input);
    const actionMapping = INTENT_ACTION_MAP[parsed.intentType] || { action: null, handler: null };

    // Dry run: return parsed intent without executing
    if (dry_run) {
      return res.json({
        success: true,
        parsed,
        actionMapping,
        executed: null,
        message: 'Dry run - no action executed'
      });
    }

    // Confidence threshold check (default 0.4, configurable)
    const threshold = confidence_threshold ?? 0.4;
    if (parsed.confidence < threshold) {
      return res.json({
        success: true,
        parsed,
        actionMapping,
        executed: null,
        message: `Confidence ${parsed.confidence.toFixed(2)} below threshold ${threshold} - no action executed`
      });
    }

    // Path 1: Direct brain action (via handleAction for whitelist + idempotency + logging)
    if (parsed.suggestedAction) {
      const { action, params } = parsed.suggestedAction;
      const idempotencyKey = `intent-${action}-${crypto.randomUUID()}`;
      const result = await handleAction(action, params, idempotencyKey, 'intent-execute');

      return res.json({
        success: true,
        parsed,
        actionMapping,
        executed: { type: 'action', action, params, result }
      });
    }

    // Path 2: Handler-based execution
    if (actionMapping.handler) {
      let handlerResult;

      if (actionMapping.handler === 'queryStatus') {
        handlerResult = await executeQueryStatus(parsed);
      } else if (actionMapping.handler === 'parseAndCreate') {
        const createResult = await parseAndCreate(input);
        handlerResult = {
          handler: 'parseAndCreate',
          project: createResult.created.project,
          tasks: createResult.created.tasks
        };
      }

      if (handlerResult) {
        await internalLogDecision(
          'intent-execute',
          input.slice(0, 200),
          { handler: actionMapping.handler, intentType: parsed.intentType },
          handlerResult
        );

        return res.json({
          success: true,
          parsed,
          actionMapping,
          executed: { type: 'handler', handler: actionMapping.handler, result: handlerResult }
        });
      }
    }

    // No action or handler matched
    res.json({
      success: true,
      parsed,
      actionMapping,
      executed: null,
      message: 'No action or handler mapped for this intent type'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to execute intent',
      details: err.message
    });
  }
});

// ==================== Enhanced Intent API (PRD: Intent Enhancement) ====================

/**
 * POST /api/brain/parse-intent
 * Parse natural language input and return structured intent with entities
 * Enhanced version with phrase matching and entity extraction
 *
 * Request body:
 *   { input: "我想给用户管理模块添加批量导入功能" }
 *
 * Response:
 *   {
 *     success: true,
 *     intentType: "create_feature",
 *     confidence: 0.85,
 *     entities: { module: "用户管理", feature: "批量导入" },
 *     suggestedTasks: [...]
 *   }
 */
router.post('/parse-intent', async (req, res) => {
  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    const parsed = await parseIntent(input);

    // Format response according to PRD specification
    res.json({
      success: true,
      intentType: parsed.intentType,
      confidence: parsed.confidence,
      keywords: parsed.keywords,
      matchedPhrases: parsed.matchedPhrases,
      entities: parsed.entities,
      projectName: parsed.projectName,
      suggestedTasks: parsed.tasks.map(t => ({
        title: t.title,
        priority: t.priority,
        description: t.description
      })),
      prdDraft: parsed.prdDraft
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to parse intent',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/intent-to-tasks
 * Convert intent directly to tasks in database
 *
 * Request body:
 *   {
 *     input: "我想给用户管理模块添加批量导入功能",
 *     options: {
 *       createProject: false,
 *       projectId: "uuid",
 *       goalId: "uuid"
 *     }
 *   }
 *
 * Response:
 *   {
 *     success: true,
 *     intent: { type, confidence, entities },
 *     tasksCreated: [{ id, title, priority, status }]
 *   }
 */
router.post('/intent-to-tasks', async (req, res) => {
  try {
    const { input, options = {} } = req.body;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be a string'
      });
    }

    // Parse and create in database
    const result = await parseAndCreate(input, {
      createProject: options.createProject !== false,
      createTasks: true,
      projectId: options.projectId || null,
      goalId: options.goalId || null
    });

    res.json({
      success: true,
      intent: {
        type: result.parsed.intentType,
        confidence: result.parsed.confidence,
        entities: result.parsed.entities,
        keywords: result.parsed.keywords
      },
      projectUsed: result.created.project ? {
        id: result.created.project.id,
        name: result.created.project.name,
        created: result.created.project.created
      } : null,
      tasksCreated: result.created.tasks.map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status
      }))
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to convert intent to tasks',
      details: err.message
    });
  }
});

// ==================== Execution Callback API ====================

/**
 * POST /api/brain/execution-callback
 * Webhook endpoint for cecelia-run to report execution completion
 *
 * Request body:
 *   {
 *     task_id: "uuid",
 *     run_id: "run-xxx-timestamp",
 *     checkpoint_id: "cp-xxx",
 *     status: "AI Done" | "AI Failed",
 *     result: { ... },  // JSON result from cecelia-run
 *     pr_url: "https://github.com/...",  // optional
 *     duration_ms: 123456,
 *     iterations: 3
 *   }
 */
router.post('/execution-callback', async (req, res) => {
  try {
    const {
      task_id,
      run_id,
      checkpoint_id,
      status,
      result,
      pr_url,
      duration_ms,
      iterations
    } = req.body;

    if (!task_id) {
      return res.status(400).json({
        success: false,
        error: 'task_id is required'
      });
    }

    console.log(`[execution-callback] Received callback for task ${task_id}, status: ${status}`);

    // 1. Determine new status
    let newStatus;
    if (status === 'AI Done') {
      newStatus = 'completed';
    } else if (status === 'AI Failed') {
      newStatus = 'failed';
    } else {
      newStatus = 'in_progress'; // Unknown status, keep in progress
    }

    // 2. Build the update payload
    const lastRunResult = {
      run_id,
      checkpoint_id,
      status,
      duration_ms,
      iterations,
      pr_url: pr_url || null,
      completed_at: new Date().toISOString(),
      result_summary: typeof result === 'object' ? result.result : result
    };

    // 3. ATOMIC: DB update + activeProcess cleanup in a single transaction
    //    This eliminates the race window where tick could see stale state.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update task in database
      await client.query(`
        UPDATE tasks
        SET
          status = $2,
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
            'last_run_result', $3::jsonb,
            'run_status', $4,
            'pr_url', $5
          ),
          completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END
        WHERE id = $1
      `, [task_id, newStatus, JSON.stringify(lastRunResult), status, pr_url || null]);

      // Log the execution result
      await client.query(`
        INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'execution-callback',
        `Task ${task_id} execution completed with status: ${status}`,
        { task_id, run_id, status, iterations },
        lastRunResult,
        status === 'AI Done' ? 'success' : 'failed'
      ]);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Clean up executor's activeProcesses registry (after commit, safe to do)
    try {
      const { removeActiveProcess } = await import('./executor.js');
      removeActiveProcess(task_id);
    } catch { /* ignore if executor not available */ }

    console.log(`[execution-callback] Task ${task_id} updated to ${newStatus} (atomic)`);

    // Record to EventBus, Circuit Breaker, and Notifier
    if (newStatus === 'completed') {
      await emitEvent('task_completed', 'executor', { task_id, run_id, duration_ms });
      await cbSuccess('cecelia-run');
      notifyTaskCompleted({ task_id, title: `Task ${task_id}`, run_id, duration_ms }).catch(() => {});

      // Publish WebSocket event: task completed
      publishTaskCompleted(task_id, run_id, { pr_url, duration_ms, iterations });

      // Thalamus: Analyze task completion event
      try {
        const thalamusEvent = {
          type: EVENT_TYPES.TASK_COMPLETED,
          task_id,
          run_id,
          duration_ms,
          has_issues: false
        };
        const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
        console.log(`[execution-callback] Thalamus decision: level=${thalamusDecision.level}, actions=${thalamusDecision.actions.map(a => a.type).join(',')}`);

        // Execute thalamus decision if not fallback
        if (thalamusDecision.actions?.[0]?.type !== 'fallback_to_tick') {
          await executeThalamusDecision(thalamusDecision);
        }
      } catch (thalamusErr) {
        console.error(`[execution-callback] Thalamus error: ${thalamusErr.message}`);
        // Continue with normal flow if thalamus fails
      }
    } else if (newStatus === 'failed') {
      await emitEvent('task_failed', 'executor', { task_id, run_id, status });
      await cbFailure('cecelia-run');
      notifyTaskFailed({ task_id, title: `Task ${task_id}`, reason: status }).catch(() => {});

      // Publish WebSocket event: task failed
      publishTaskFailed(task_id, run_id, status);

      // === Failure Classification & Smart Retry ===
      let failureHandled = false;
      let quarantined = false;
      try {
        // Extract error message from result
        const errorMsg = typeof result === 'object'
          ? (result.result || result.error || result.stderr || JSON.stringify(result))
          : String(result || status);

        // Classify the failure
        const { classifyFailure } = await import('./quarantine.js');
        const taskRow = await pool.query('SELECT payload FROM tasks WHERE id = $1', [task_id]);
        const taskPayload = taskRow.rows[0]?.payload || {};
        const classification = classifyFailure(errorMsg, { payload: taskPayload });

        console.log(`[execution-callback] Failure classified: task=${task_id} class=${classification.class} pattern=${classification.pattern}`);

        // Store classification in task payload
        await pool.query(
          `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [task_id, JSON.stringify({
            failure_class: classification.class,
            failure_detail: { pattern: classification.pattern, error_excerpt: errorMsg.slice(0, 500) },
          })]
        );

        const strategy = classification.retry_strategy;

        if (strategy && strategy.should_retry) {
          // Smart retry: requeue with next_run_at
          const retryCount = (taskPayload.failure_count || 0) + 1;
          await pool.query(
            `UPDATE tasks SET status = 'queued', started_at = NULL,
             payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
             WHERE id = $1 AND status = 'failed'`,
            [task_id, JSON.stringify({
              next_run_at: strategy.next_run_at,
              failure_count: retryCount,
              smart_retry: { class: classification.class, attempt: retryCount, scheduled_at: strategy.next_run_at },
            })]
          );
          console.log(`[execution-callback] Smart retry: task=${task_id} class=${classification.class} next_run_at=${strategy.next_run_at}`);
          failureHandled = true;

          // Billing pause: stop all dispatch until reset
          if (strategy.billing_pause) {
            const { setBillingPause } = await import('./executor.js');
            setBillingPause(strategy.next_run_at, `billing_cap (task ${task_id})`);
          }
        } else if (strategy && strategy.needs_human_review) {
          // No retry, mark for human review
          await pool.query(
            `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
            [task_id, JSON.stringify({ needs_human_review: true })]
          );
          console.log(`[execution-callback] Needs human review: task=${task_id} class=${classification.class}`);
        }
      } catch (classifyErr) {
        console.error(`[execution-callback] Classification error: ${classifyErr.message}`);
      }

      // Check if task should be quarantined (only if not already handled by smart retry)
      if (!failureHandled) {
        try {
          const quarantineResult = await handleTaskFailure(task_id);
          if (quarantineResult.quarantined) {
            quarantined = true;
            console.log(`[execution-callback] Task ${task_id} quarantined: ${quarantineResult.result?.reason}`);
            notifyTaskFailed({
              task_id,
              title: `Task ${task_id} QUARANTINED`,
              reason: `Quarantined: ${quarantineResult.result?.reason}`
            }).catch(() => {});
          }
        } catch (quarantineErr) {
          console.error(`[execution-callback] Quarantine check error: ${quarantineErr.message}`);
        }
      }

      // Thalamus: Analyze task failure event (more complex, may need deeper analysis)
      if (!quarantined) {
        try {
          const thalamusEvent = {
            type: EVENT_TYPES.TASK_FAILED,
            task_id,
            run_id,
            error: status,
            retry_count: iterations || 0
          };
          const thalamusDecision = await thalamusProcessEvent(thalamusEvent);
          console.log(`[execution-callback] Thalamus decision for failure: level=${thalamusDecision.level}, actions=${thalamusDecision.actions.map(a => a.type).join(',')}`);

          // Execute thalamus decision
          await executeThalamusDecision(thalamusDecision);
        } catch (thalamusErr) {
          console.error(`[execution-callback] Thalamus error on failure: ${thalamusErr.message}`);
        }
      }
    }

    // 5. Rollup progress to KR and O
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        // Get the task's goal_id (which is a KR)
        const taskRow = await pool.query('SELECT goal_id FROM tasks WHERE id = $1', [task_id]);
        const krId = taskRow.rows[0]?.goal_id;

        if (krId) {
          // Calculate KR progress from its tasks
          const krTasks = await pool.query(
            "SELECT COUNT(*) as total, COUNT(CASE WHEN status='completed' THEN 1 END) as done FROM tasks WHERE goal_id = $1",
            [krId]
          );
          const { total, done } = krTasks.rows[0];
          const krProgress = total > 0 ? Math.round((parseInt(done) / parseInt(total)) * 100) : 0;

          await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [krProgress, krId]);
          console.log(`[execution-callback] KR ${krId} progress → ${krProgress}%`);

          // Get parent O and rollup from all KRs
          const krRow = await pool.query('SELECT parent_id FROM goals WHERE id = $1', [krId]);
          const oId = krRow.rows[0]?.parent_id;

          if (oId) {
            const allKRs = await pool.query(
              'SELECT progress, weight FROM goals WHERE parent_id = $1',
              [oId]
            );
            const totalWeight = allKRs.rows.reduce((s, r) => s + parseFloat(r.weight || 1), 0);
            const weightedProgress = allKRs.rows.reduce(
              (s, r) => s + (r.progress || 0) * parseFloat(r.weight || 1), 0
            );
            const oProgress = totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0;

            await pool.query('UPDATE goals SET progress = $1 WHERE id = $2', [oProgress, oId]);
            console.log(`[execution-callback] O ${oId} progress → ${oProgress}%`);
          }
        }
      } catch (rollupErr) {
        console.error(`[execution-callback] Progress rollup error: ${rollupErr.message}`);
      }
    }

    // 5b. 探索型任务闭环：Task 完成后回调秋米继续拆解
    if (newStatus === 'completed') {
      try {
        // 获取 Task 的 payload 检查是否是探索型
        const taskResult = await pool.query('SELECT payload, project_id, goal_id FROM tasks WHERE id = $1', [task_id]);
        const taskPayload = taskResult.rows[0]?.payload;
        const featureId = taskResult.rows[0]?.project_id;
        const krId = taskResult.rows[0]?.goal_id;

        if (taskPayload?.exploratory === true && featureId) {
          console.log(`[execution-callback] Exploratory task completed, triggering continue decomposition...`);

          // 获取 Feature 信息
          const featureResult = await pool.query('SELECT name, kr_id, decomposition_mode FROM projects WHERE id = $1', [featureId]);
          const feature = featureResult.rows[0];

          if (feature?.decomposition_mode === 'exploratory') {
            // 获取 KR 目标
            const krResult = await pool.query('SELECT title FROM goals WHERE id = $1', [krId || feature.kr_id]);
            const krGoal = krResult.rows[0]?.title || 'Unknown KR';

            // 创建"继续拆解"任务给秋米
            const { createTask: createDecompTask } = await import('./actions.js');
            await createDecompTask({
              title: `继续拆解: ${feature.name}`,
              description: `探索型 Task 完成，请根据结果继续拆解下一步。\n\nFeature: ${feature.name}\nKR 目标: ${krGoal}\n\n上一步结果将在执行时传入。`,
              task_type: 'dev',
              priority: 'P0',
              goal_id: krId || feature.kr_id,
              project_id: featureId,
              payload: {
                decomposition: 'continue',
                feature_id: featureId,
                previous_task_id: task_id,
                previous_result: result?.result || result,
                kr_goal: krGoal
              }
            });

            console.log(`[execution-callback] Created continue decomposition task for feature: ${feature.name}`);
          }
        }
      } catch (exploratoryErr) {
        console.error(`[execution-callback] Exploratory handling error: ${exploratoryErr.message}`);
      }

      // 5c. Review 闭环：发现问题 → 自动创建修复 Task
      try {
        const taskResult = await pool.query('SELECT task_type, project_id, goal_id, title FROM tasks WHERE id = $1', [task_id]);
        const taskRow = taskResult.rows[0];

        if (taskRow?.task_type === 'review') {
          console.log(`[execution-callback] Review task completed, checking for issues...`);

          // 解析结果，查找 L1/L2 问题
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result || {});
          const hasL1 = /L1[：:]/i.test(resultStr) || /\bL1\b.*问题/i.test(resultStr);
          const hasL2 = /L2[：:]/i.test(resultStr) || /\bL2\b.*问题/i.test(resultStr);

          if (hasL1 || hasL2) {
            console.log(`[execution-callback] Review found issues (L1: ${hasL1}, L2: ${hasL2}), creating fix task...`);

            // 提取问题描述作为 PRD
            const issueLevel = hasL1 ? 'L1 (阻塞级)' : 'L2 (功能级)';
            const prdContent = `# PRD - 修复 Review 发现的问题

## 背景
Review 任务 "${taskRow.title}" 发现了 ${issueLevel} 问题需要修复。

## 问题描述
${resultStr.substring(0, 2000)}

## 目标
修复 Review 发现的所有 ${issueLevel} 问题。

## 验收标准
- [ ] 所有 L1 问题已修复
- [ ] 所有 L2 问题已修复
- [ ] 修复后代码通过测试
- [ ] 再次 Review 无新问题

## 技术要点
根据 Review 报告中的具体建议进行修复。`;

            const { createTask: createFixTask } = await import('./actions.js');
            await createFixTask({
              title: `修复: ${taskRow.title.replace(/^(每日质检|Review)[：:]\s*/i, '')}`,
              description: `Review 发现 ${issueLevel} 问题，需要修复`,
              task_type: 'dev',
              priority: hasL1 ? 'P0' : 'P1',
              project_id: taskRow.project_id,
              goal_id: taskRow.goal_id,
              prd_content: prdContent,
              payload: {
                triggered_by: 'review',
                review_task_id: task_id,
                issue_level: hasL1 ? 'L1' : 'L2'
              }
            });

            console.log(`[execution-callback] Created fix task for review issues`);
          } else {
            console.log(`[execution-callback] Review passed, no L1/L2 issues found`);
          }
        }
      } catch (reviewErr) {
        console.error(`[execution-callback] Review handling error: ${reviewErr.message}`);
      }
    }

    // 6. Event-driven: Trigger next task immediately after completion
    let nextTickResult = null;
    if (newStatus === 'completed') {
      console.log(`[execution-callback] Task completed, triggering next tick...`);
      try {
        nextTickResult = await runTickSafe('execution-callback');
        console.log(`[execution-callback] Next tick triggered, actions: ${nextTickResult.actions_taken?.length || 0}`);
      } catch (tickErr) {
        console.error(`[execution-callback] Failed to trigger next tick: ${tickErr.message}`);
      }
    }

    res.json({
      success: true,
      task_id,
      new_status: newStatus,
      message: `Task updated to ${newStatus}`,
      next_tick: nextTickResult
    });

  } catch (err) {
    console.error('[execution-callback] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process execution callback',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/heartbeat
 * Heartbeat endpoint for running tasks to report liveness.
 *
 * Request body:
 *   {
 *     task_id: "uuid",
 *     run_id: "run-xxx-timestamp"  // optional, for validation
 *   }
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { task_id, run_id } = req.body;

    if (!task_id) {
      return res.status(400).json({ success: false, error: 'task_id is required' });
    }

    const { recordHeartbeat } = await import('./executor.js');
    const result = await recordHeartbeat(task_id, run_id);

    res.json(result);
  } catch (err) {
    console.error('[heartbeat] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/executor/status
 * Check if cecelia-run executor is available
 */
router.get('/executor/status', async (req, res) => {
  try {
    const { checkCeceliaRunAvailable } = await import('./executor.js');
    const status = await checkCeceliaRunAvailable();
    res.json(status);
  } catch (err) {
    res.status(500).json({
      available: false,
      error: err.message
    });
  }
});

// ==================== Cluster Status API ====================

/**
 * GET /api/brain/cluster/status
 * Get status of all servers in the cluster (US + HK)
 */
router.get('/cluster/status', async (req, res) => {
  try {
    const os = await import('os');

    // Get US VPS slots using same logic as /vps-slots
    let usProcesses = [];
    try {
      const { stdout } = await execAsync('ps aux | grep -E " claude( |$)" | grep -v "grep" | grep -v "/bin/bash"');
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          usProcesses.push({
            pid: parseInt(parts[1]),
            cpu: `${parts[2]}%`,
            memory: `${parts[3]}%`,
            startTime: parts[8],
            command: parts.slice(10).join(' ').slice(0, 80)
          });
        }
      }
    } catch { /* no processes */ }

    const usUsed = usProcesses.length;
    const usCpuLoad = os.loadavg()[0];
    const usCpuCores = os.cpus().length;
    const usMemTotal = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
    const usMemFree = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
    const usMemUsedPct = Math.round((1 - os.freemem() / os.totalmem()) * 100);

    // 动态计算可用席位 (85% 安全阈值)
    const CPU_PER_CLAUDE = 0.5;
    const MEM_PER_CLAUDE_GB = 1.0;
    const SAFETY_MARGIN = 0.85;

    const usCpuTarget = usCpuCores * SAFETY_MARGIN;
    const usCpuHeadroom = Math.max(0, usCpuTarget - usCpuLoad);
    const usCpuAllowed = Math.floor(usCpuHeadroom / CPU_PER_CLAUDE);
    const usMemAvailable = Math.max(0, usMemFree - 2); // 保留 2GB
    const usMemAllowed = Math.floor(usMemAvailable / MEM_PER_CLAUDE_GB);
    const usDynamicMax = Math.min(usCpuAllowed, usMemAllowed, 12); // 硬上限 12

    const usServer = {
      id: 'us',
      name: 'US VPS',
      location: '🇺🇸 美国',
      ip: '146.190.52.84',
      status: 'online',
      resources: {
        cpu_cores: usCpuCores,
        cpu_load: Math.round(usCpuLoad * 10) / 10,
        cpu_pct: Math.round((usCpuLoad / usCpuCores) * 100),
        mem_total_gb: usMemTotal,
        mem_free_gb: usMemFree,
        mem_used_pct: usMemUsedPct
      },
      slots: {
        max: 12,              // 理论最大
        dynamic_max: usDynamicMax, // 当前资源可支持的最大
        used: usUsed,
        available: Math.max(0, usDynamicMax - usUsed - 1), // 减 1 预留
        reserved: 1,
        processes: usProcesses
      },
      task_types: ['dev', 'review', 'qa', 'audit']
    };

    // HK server status (via bridge)
    let hkServer = {
      id: 'hk',
      name: 'HK VPS',
      location: '🇭🇰 香港',
      ip: '43.154.85.217',
      status: 'offline',
      resources: null,
      slots: {
        max: 5,               // 理论最大
        dynamic_max: 0,       // 当前资源可支持的最大
        used: 0,
        available: 0,
        reserved: 0,
        processes: []
      },
      task_types: ['talk', 'research', 'data']
    };

    // Try to fetch HK status from bridge
    try {
      const hkBridgeUrl = process.env.HK_BRIDGE_URL || 'http://100.86.118.99:5225';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const hkRes = await fetch(`${hkBridgeUrl}/status`, { signal: controller.signal });
      clearTimeout(timeout);

      if (hkRes.ok) {
        const hkData = await hkRes.json();
        const hkResources = hkData.resources || {
          cpu_cores: 4,
          cpu_load: 0,
          cpu_pct: 0,
          mem_total_gb: 7.6,
          mem_free_gb: 5,
          mem_used_pct: 30
        };

        // 计算 HK 动态可用席位
        const hkCpuTarget = hkResources.cpu_cores * SAFETY_MARGIN;
        const hkCpuHeadroom = Math.max(0, hkCpuTarget - hkResources.cpu_load);
        const hkCpuAllowed = Math.floor(hkCpuHeadroom / CPU_PER_CLAUDE);
        const hkMemAvailable = Math.max(0, hkResources.mem_free_gb - 1.5); // HK 保留 1.5GB
        const hkMemAllowed = Math.floor(hkMemAvailable / MEM_PER_CLAUDE_GB);
        const hkDynamicMax = Math.min(hkCpuAllowed, hkMemAllowed, 5); // 硬上限 5
        const hkUsed = hkData.slots?.used || 0;

        hkServer = {
          ...hkServer,
          status: 'online',
          resources: hkResources,
          slots: {
            max: 5,
            dynamic_max: hkDynamicMax,
            used: hkUsed,
            available: Math.max(0, hkDynamicMax - hkUsed),
            reserved: 0,
            processes: hkData.slots?.processes || []
          }
        };
      }
    } catch {
      // HK bridge not available, keep offline status
    }

    // Calculate cluster totals
    const totalSlots = usServer.slots.max + hkServer.slots.max;
    const totalUsed = usServer.slots.used + hkServer.slots.used;
    const totalAvailable = usServer.slots.available + hkServer.slots.available;

    res.json({
      success: true,
      cluster: {
        total_slots: totalSlots,
        total_used: totalUsed,
        total_available: totalAvailable,
        servers: [usServer, hkServer]
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cluster status',
      details: err.message
    });
  }
});

// ==================== Generate API ====================

/**
 * POST /api/brain/generate/prd
 * Generate a PRD from task description
 */
router.post('/generate/prd', async (req, res) => {
  try {
    const { title, description, type = 'feature', goal_id } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    if (goal_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(goal_id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid goal_id format (must be UUID)'
        });
      }

      const goalResult = await pool.query('SELECT * FROM goals WHERE id = $1', [goal_id]);
      const goal = goalResult.rows[0];

      let projectData = null;
      if (goal) {
        const linkResult = await pool.query(
          'SELECT p.* FROM projects p JOIN project_kr_links l ON p.id = l.project_id WHERE l.kr_id = $1 LIMIT 1',
          [goal_id]
        );
        if (linkResult.rows[0]) {
          projectData = { name: linkResult.rows[0].name, repo_path: linkResult.rows[0].repo_path };
        }
      }

      const prd = generatePrdFromGoalKR({
        title,
        description: description || '',
        kr: goal ? { title: goal.title, progress: goal.progress, priority: goal.priority } : undefined,
        project: projectData || undefined
      });

      if (req.body.format === 'json') {
        return res.json({ success: true, data: prdToJson(prd), metadata: { title, goal_id, goal_found: !!goal, generated_at: new Date().toISOString() } });
      }

      return res.json({
        success: true,
        prd,
        metadata: {
          title,
          goal_id,
          goal_found: !!goal,
          generated_at: new Date().toISOString()
        }
      });
    }

    const validTypes = Object.keys(PRD_TYPE_MAP);
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const prd = generatePrdFromTask({ title, description, type });

    if (req.body.format === 'json') {
      return res.json({ success: true, data: prdToJson(prd), metadata: { title, type, generated_at: new Date().toISOString() } });
    }

    res.json({
      success: true,
      prd,
      metadata: {
        title,
        type,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate PRD',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/generate/trd
 * Generate a TRD from goal description
 */
router.post('/generate/trd', async (req, res) => {
  try {
    const { title, description, milestones = [], kr, project } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    const trd = kr
      ? generateTrdFromGoalKR({ title, description, milestones, kr, project })
      : generateTrdFromGoal({ title, description, milestones });

    if (req.body.format === 'json') {
      return res.json({ success: true, data: trdToJson(trd), metadata: { title, milestones_count: milestones.length, generated_at: new Date().toISOString() } });
    }

    res.json({
      success: true,
      trd,
      metadata: {
        title,
        milestones_count: milestones.length,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate TRD',
      details: err.message
    });
  }
});

// ==================== Validate API ====================

/**
 * POST /api/brain/validate/prd
 * Validate PRD content against standardization rules
 */
router.post('/validate/prd', (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const result = validatePrd(content);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Validation failed', details: err.message });
  }
});

/**
 * POST /api/brain/validate/trd
 * Validate TRD content against standardization rules
 */
router.post('/validate/trd', (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const result = validateTrd(content);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Validation failed', details: err.message });
  }
});

// TRD API — removed (decomposer.js deleted, TRD decomposition now handled by 秋米 /okr)


/**
 * POST /api/brain/goal/compare
 * Compare goal progress against expected progress
 */
router.post('/goal/compare', async (req, res) => {
  try {
    const { goal_id } = req.body;
    const report = await compareGoalProgress(goal_id || null);

    res.json({
      success: true,
      ...report
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to compare goal progress',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decide
 * Generate decision based on current state
 */
router.post('/decide', async (req, res) => {
  try {
    const context = req.body.context || {};
    const decision = await generateDecision(context);

    res.json({
      success: true,
      ...decision
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate decision',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decision/:id/execute
 * Execute a pending decision
 */
router.post('/decision/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeDecision(id);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: 'Failed to execute decision',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decision/:id/rollback
 * Rollback an executed decision
 */
router.post('/decision/:id/rollback', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await rollbackDecision(id);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: 'Failed to rollback decision',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/decisions
 * Get decision history
 */
router.get('/decisions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const decisions = await getDecisionHistory(limit);

    res.json({
      success: true,
      decisions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get decision history',
      details: err.message
    });
  }
});

// ==================== VPS Slots API ====================

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

/**
 * GET /api/brain/vps-slots
 * Get real Claude process information with task details
 */
router.get('/vps-slots', async (req, res) => {
  try {
    const tickStatus = await getTickStatus();
    const MAX_SLOTS = tickStatus.max_concurrent || 6;

    // Get tracked processes from executor
    let trackedProcesses = [];
    try {
      const { getActiveProcesses } = await import('./executor.js');
      trackedProcesses = getActiveProcesses();
    } catch {
      // executor not available
    }

    // Get Claude processes from OS
    let slots = [];
    try {
      const { stdout } = await execAsync('ps aux | grep -E " claude( |$)" | grep -v "grep" | grep -v "/bin/bash"');
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1]);
          const cpu = parts[2];
          const mem = parts[3];
          const startTime = parts[8];
          const command = parts.slice(10).join(' ');

          // Match PID to tracked process for task details
          const tracked = trackedProcesses.find(p => p.pid === pid);

          slots.push({
            pid,
            cpu: `${cpu}%`,
            memory: `${mem}%`,
            startTime,
            taskId: tracked?.taskId || null,
            runId: tracked?.runId || null,
            startedAt: tracked?.startedAt || null,
            command: command.slice(0, 100) + (command.length > 100 ? '...' : '')
          });
        }
      }
    } catch {
      slots = [];
    }

    // Enrich with task details from DB
    const taskIds = slots.map(s => s.taskId).filter(Boolean);
    let taskMap = {};
    if (taskIds.length > 0) {
      try {
        const result = await pool.query(
          `SELECT id, title, priority, status, task_type FROM tasks WHERE id = ANY($1)`,
          [taskIds]
        );
        for (const row of result.rows) {
          taskMap[row.id] = row;
        }
      } catch {
        // continue without task details
      }
    }

    const enrichedSlots = slots.map(s => {
      const task = s.taskId ? taskMap[s.taskId] : null;
      return {
        ...s,
        taskTitle: task?.title || null,
        taskPriority: task?.priority || null,
        taskType: task?.task_type || null,
      };
    });

    res.json({
      success: true,
      total: MAX_SLOTS,
      used: enrichedSlots.length,
      available: MAX_SLOTS - enrichedSlots.length,
      slots: enrichedSlots
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get VPS slots',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/execution-history
 * Get cecelia execution history from decision_log
 */
router.get('/execution-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    // Get execution records from decision_log where trigger = 'cecelia-executor' or 'tick'
    const result = await pool.query(`
      SELECT
        id,
        trigger,
        input_summary,
        action_result_json,
        status,
        created_at
      FROM decision_log
      WHERE trigger IN ('cecelia-executor', 'tick', 'execution-callback')
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const executions = result.rows.map(row => ({
      id: row.id,
      trigger: row.trigger,
      summary: row.input_summary,
      result: row.action_result_json,
      status: row.status,
      timestamp: row.created_at
    }));

    // Count today's executions
    const todayResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM decision_log
      WHERE trigger IN ('cecelia-executor', 'tick', 'execution-callback')
        AND created_at >= CURRENT_DATE
    `);

    res.json({
      success: true,
      total: executions.length,
      today: parseInt(todayResult.rows[0].count),
      executions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get execution history',
      details: err.message
    });
  }
});

// ==================== Execution Status API ====================

/**
 * GET /api/brain/cecelia/overview
 * Overview of Cecelia execution: running/completed/failed counts + recent runs
 */
router.get('/cecelia/overview', async (req, res) => {
  try {
    const { getActiveProcesses, getActiveProcessCount } = await import('./executor.js');

    // Get task counts from database
    const countsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'in_progress') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM tasks
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    const counts = countsResult.rows[0];

    // Get recent runs (tasks with execution info)
    const recentResult = await pool.query(`
      SELECT
        t.id,
        t.title as project,
        t.status,
        t.priority,
        t.task_type,
        t.created_at as started_at,
        t.completed_at,
        t.payload->>'current_run_id' as run_id,
        t.payload->>'run_status' as run_status,
        t.payload->'last_run_result' as last_result,
        COALESCE(t.payload->>'feature_branch', '') as feature_branch
      FROM tasks t
      WHERE t.created_at >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    // Map to expected format
    const recentRuns = recentResult.rows.map(row => ({
      id: row.id,
      project: row.project || 'Unknown',
      feature_branch: row.feature_branch || '',
      status: row.status || 'pending',
      total_checkpoints: 11,
      completed_checkpoints: row.status === 'completed' ? 11 : row.status === 'in_progress' ? 5 : 0,
      failed_checkpoints: row.status === 'failed' ? 1 : 0,
      current_checkpoint: row.run_status || null,
      started_at: row.started_at,
      updated_at: row.completed_at || row.started_at,
    }));

    // Get live process info
    const activeProcs = getActiveProcesses();
    const activeCount = getActiveProcessCount();

    res.json({
      success: true,
      total_runs: parseInt(counts.total),
      running: parseInt(counts.running),
      completed: parseInt(counts.completed),
      failed: parseInt(counts.failed),
      active_processes: activeCount,
      recent_runs: recentRuns,
      live_processes: activeProcs,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cecelia overview',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/health
 * Health check for dev task tracking
 */
router.get('/dev/health', async (req, res) => {
  try {
    const { checkCeceliaRunAvailable, getActiveProcessCount } = await import('./executor.js');

    const executorAvailable = await checkCeceliaRunAvailable();
    const activeCount = getActiveProcessCount();

    // Check DB connectivity
    const dbResult = await pool.query('SELECT 1 as ok');
    const dbOk = dbResult.rows.length > 0;

    res.json({
      success: true,
      data: {
        status: dbOk && executorAvailable.available ? 'healthy' : 'degraded',
        trackedRepos: [],
        executor: {
          available: executorAvailable.available,
          activeProcesses: activeCount,
        },
        database: {
          connected: dbOk,
        },
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/tasks
 * Get all active dev tasks with step status
 */
router.get('/dev/tasks', async (req, res) => {
  try {
    const { getActiveProcesses } = await import('./executor.js');

    // Get active tasks (in_progress or recently completed dev tasks)
    const result = await pool.query(`
      SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t.task_type,
        t.created_at,
        t.completed_at,
        t.payload,
        g.title as goal_title,
        p.name as project_name,
        p.repo_path
      FROM tasks t
      LEFT JOIN goals g ON t.goal_id = g.id
      LEFT JOIN projects p ON g.project_id = p.id
      WHERE t.task_type IN ('dev', 'review')
        AND (t.status IN ('in_progress', 'queued') OR t.completed_at >= CURRENT_DATE - INTERVAL '1 day')
      ORDER BY
        CASE t.status WHEN 'in_progress' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
        t.created_at DESC
      LIMIT 20
    `);

    // Get live process info
    const activeProcs = getActiveProcesses();
    const procMap = new Map(activeProcs.map(p => [p.taskId, p]));

    // Map to DevTaskStatus format
    const tasks = result.rows.map(row => {
      const payload = row.payload || {};
      const proc = procMap.get(row.id);

      // Build step items from payload or defaults
      const stepNames = ['PRD', 'Detect', 'Branch', 'DoD', 'Code', 'Test', 'Quality', 'PR', 'CI', 'Learning', 'Cleanup'];
      const steps = stepNames.map((name, idx) => {
        const stepKey = `step_${idx + 1}`;
        const stepStatus = payload[stepKey] || 'pending';
        return {
          id: idx + 1,
          name,
          status: stepStatus === 'done' ? 'done' : stepStatus,
        };
      });

      // Determine current step
      const currentStep = steps.find(s => s.status === 'in_progress');
      const completedSteps = steps.filter(s => s.status === 'done').length;

      return {
        repo: {
          name: row.project_name || row.title,
          path: row.repo_path || '',
          remoteUrl: '',
        },
        branches: {
          main: 'main',
          develop: 'develop',
          feature: payload.feature_branch || null,
          current: payload.feature_branch || 'develop',
          type: payload.feature_branch?.startsWith('cp-') ? 'cp' : payload.feature_branch?.startsWith('feature/') ? 'feature' : 'unknown',
        },
        task: {
          name: row.title,
          createdAt: row.created_at,
          prNumber: payload.pr_number || null,
          prUrl: payload.pr_url || null,
          prState: payload.pr_state || null,
        },
        steps: {
          current: currentStep ? currentStep.id : completedSteps + 1,
          total: 11,
          items: steps,
        },
        quality: {
          ci: payload.ci_status || 'unknown',
          codex: 'unknown',
          lastCheck: row.completed_at || row.created_at,
        },
        updatedAt: row.completed_at || row.created_at,
        processAlive: proc ? proc.alive : false,
      };
    });

    res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get dev tasks',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/repos
 * Get list of tracked repositories
 */
router.get('/dev/repos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT p.name, p.repo_path
      FROM projects p
      WHERE p.repo_path IS NOT NULL
      ORDER BY p.name
    `);

    res.json({
      success: true,
      data: result.rows.map(r => r.repo_path || r.name),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get repos',
      details: err.message,
    });
  }
});

// ==================== Planner API ====================

/**
 * POST /api/brain/plan
 * Accept input and create resources at the correct OKR level
 */
router.post('/plan', async (req, res) => {
  try {
    const { input, dry_run = false } = req.body;

    if (!input || typeof input !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be an object containing one of: objective, key_result, project, task'
      });
    }

    const result = await handlePlanInput(input, dry_run);

    res.json({
      success: true,
      dry_run,
      ...result
    });
  } catch (err) {
    const status = err.message.startsWith('Hard constraint') ? 400 : 500;
    res.status(status).json({
      success: false,
      error: err.message
    });
  }
});

// POST /api/brain/plan/llm — removed (planner-llm.js deleted, task planning now handled by 秋米 /okr)

/**
 * GET /api/brain/plan/status
 * Get current planning status (target KR, project, queued tasks)
 */
router.get('/plan/status', async (req, res) => {
  try {
    const status = await getPlanStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get plan status',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/plan/next
 * Trigger planner to select next task (same as what tick does)
 */
router.post('/plan/next', async (req, res) => {
  try {
    const result = await planNextTask();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to plan next task',
      details: err.message
    });
  }
});

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
    const [tickStatus, cbStates] = await Promise.all([
      getTickStatus(),
      Promise.resolve(getAllCBStates())
    ]);

    const openBreakers = Object.entries(cbStates)
      .filter(([, v]) => v.state === 'OPEN')
      .map(([k]) => k);

    const healthy = tickStatus.loop_running && openBreakers.length === 0;

    res.json({
      status: healthy ? 'healthy' : 'degraded',
      organs: {
        scheduler: {
          status: tickStatus.loop_running ? 'running' : 'stopped',
          enabled: tickStatus.enabled,
          last_tick: tickStatus.last_tick,
          max_concurrent: tickStatus.max_concurrent
        },
        circuit_breaker: {
          status: openBreakers.length === 0 ? 'all_closed' : 'has_open',
          open: openBreakers,
          states: cbStates
        },
        event_bus: { status: 'active' },
        notifier: { status: process.env.FEISHU_BOT_WEBHOOK ? 'configured' : 'unconfigured' },
        planner: { status: 'v2' }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
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
    const validTypes = ['goal', 'task', 'project', 'block'];
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
    const validParentTypes = ['goal', 'task', 'project', 'block'];
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

// ==================== Task Routing API ====================

/**
 * GET /api/brain/task-types
 * Get available task types and their agent mappings
 */
router.get('/task-types', (req, res) => {
  res.json({
    success: true,
    task_types: TASK_TYPE_AGENT_MAP,
    description: {
      dev: '开发任务 - 交给 Caramel (/dev)',
      talk: '对话任务 - HK MiniMax',
      qa: 'QA 任务 - 交给 小检 (/qa)',
      audit: '审计任务 - 交给 小审 (/audit)',
      research: '调研任务 - 需要人工或 Opus 处理'
    }
  });
});

/**
 * POST /api/brain/route-task
 * Get agent routing for a task
 */
router.post('/route-task', async (req, res) => {
  try {
    const { task_id, task_type } = req.body;

    let task;
    if (task_id) {
      const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found' });
      }
      task = result.rows[0];
    } else if (task_type) {
      task = { task_type };
    } else {
      return res.status(400).json({ success: false, error: 'task_id or task_type is required' });
    }

    const agent = routeTask(task);

    res.json({
      success: true,
      task_type: task.task_type || 'dev',
      agent,
      requires_manual: agent === null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to route task', details: err.message });
  }
});

// ==================== Feature Tick API ====================

/**
 * GET /api/brain/feature-tick/status
 * Get Feature tick loop status
 */
router.get('/feature-tick/status', (req, res) => {
  res.json({ success: true, ...getFeatureTickStatus() });
});

/**
 * POST /api/brain/feature-tick/enable
 * Enable Feature tick loop
 */
router.post('/feature-tick/enable', (req, res) => {
  const started = startFeatureTickLoop();
  res.json({ success: true, started, ...getFeatureTickStatus() });
});

/**
 * POST /api/brain/feature-tick/disable
 * Disable Feature tick loop
 */
router.post('/feature-tick/disable', (req, res) => {
  const stopped = stopFeatureTickLoop();
  res.json({ success: true, stopped, ...getFeatureTickStatus() });
});

// ==================== Features API ====================

/**
 * GET /api/brain/features
 * List features with optional status filter
 */
router.get('/features', async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;

    let query = `
      SELECT f.*, p.name as project_name, g.title as goal_title
      FROM features f
      LEFT JOIN projects p ON f.project_id = p.id
      LEFT JOIN goals g ON f.goal_id = g.id
    `;
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` WHERE f.status = $${paramIndex++}`;
      params.push(status);
    }

    query += ` ORDER BY f.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json({ success: true, features: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get features', details: err.message });
  }
});

/**
 * GET /api/brain/features/:id
 * Get a single feature with its tasks
 */
router.get('/features/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const feature = await getFeature(id);

    if (!feature) {
      return res.status(404).json({ success: false, error: 'Feature not found' });
    }

    // Get associated tasks
    const tasks = await pool.query(
      'SELECT * FROM tasks WHERE feature_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({ success: true, feature, tasks: tasks.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get feature', details: err.message });
  }
});

/**
 * POST /api/brain/features
 * Create a new feature
 */
router.post('/features', async (req, res) => {
  try {
    const { title, description, prd, goal_id, project_id } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }

    const feature = await createFeature({ title, description, prd, goal_id, project_id });
    res.json({ success: true, feature });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create feature', details: err.message });
  }
});

/**
 * PUT /api/brain/features/:id
 * Update a feature
 */
router.put('/features/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, active_task_id, current_pr_number } = req.body;

    const updates = {};
    if (status) updates.status = status;
    if (active_task_id !== undefined) updates.active_task_id = active_task_id;
    if (current_pr_number !== undefined) updates.current_pr_number = current_pr_number;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    await updateFeature(id, updates);
    const feature = await getFeature(id);

    res.json({ success: true, feature });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update feature', details: err.message });
  }
});

/**
 * GET /api/brain/features/:id/check-anti-crossing
 * Check if a feature allows creating a new task
 */
router.get('/features/:id/check-anti-crossing', async (req, res) => {
  try {
    const { id } = req.params;
    const check = await checkAntiCrossing(id);
    res.json({ success: true, feature_id: id, ...check });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Anti-crossing check failed', details: err.message });
  }
});

/**
 * GET /api/brain/feature-statuses
 * Get available feature status values
 */
router.get('/feature-statuses', (req, res) => {
  res.json({
    success: true,
    statuses: FEATURE_STATUS,
    description: {
      planning: '初始状态，等待规划第一个 Task',
      task_created: 'Task 已创建，等待执行',
      task_running: 'Task 正在执行',
      task_completed: 'Task 完成，等待评估',
      evaluating: '正在评估是否需要下一个 Task',
      completed: 'Feature 完成',
      cancelled: '已取消'
    }
  });
});

// ==================== Task Router API ====================

/**
 * POST /api/brain/identify-work-type
 * Identify if input is a single task or feature
 */
router.post('/identify-work-type', (req, res) => {
  try {
    const { input } = req.body;

    if (!input) {
      return res.status(400).json({ success: false, error: 'input is required' });
    }

    const workType = identifyWorkType(input);
    res.json({ success: true, input, work_type: workType });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to identify work type', details: err.message });
  }
});

/**
 * GET /api/brain/task-locations
 * Get location mapping for all task types
 */
router.get('/task-locations', (req, res) => {
  res.json({
    success: true,
    locations: LOCATION_MAP,
    valid_task_types: getValidTaskTypes(),
    description: {
      us: '美国 VPS - Claude (开发、审查)',
      hk: '香港 VPS - MiniMax (自动化、数据处理)'
    }
  });
});

/**
 * POST /api/brain/route-task-create
 * Get routing decision for creating a task
 */
router.post('/route-task-create', (req, res) => {
  try {
    const { title, task_type, feature_id, is_recurring } = req.body;

    if (!title && !task_type) {
      return res.status(400).json({ success: false, error: 'title or task_type is required' });
    }

    const routing = routeTaskCreate({ title, task_type, feature_id, is_recurring });
    res.json({ success: true, ...routing });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to route task create', details: err.message });
  }
});

/**
 * GET /api/brain/active-features
 * Get all active features with their current task status (for monitoring)
 */
router.get('/active-features', async (req, res) => {
  try {
    const features = await getActiveFeaturesWithTasks();
    res.json({ success: true, features });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get active features', details: err.message });
  }
});

/**
 * POST /api/brain/feature-task-complete
 * Handle feature task completion (called by executor)
 */
router.post('/feature-task-complete', async (req, res) => {
  try {
    const { task_id, summary, artifact_ref, quality_gate } = req.body;

    if (!task_id) {
      return res.status(400).json({ success: false, error: 'task_id is required' });
    }

    const result = await handleFeatureTaskComplete(task_id, {
      summary,
      artifact_ref,
      quality_gate
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to complete feature task', details: err.message });
  }
});

// ==================== Reflections API ====================

/**
 * GET /api/brain/reflections
 * Get reflections (issues, learnings, improvements)
 */
router.get('/reflections', async (req, res) => {
  try {
    const { type, project_id, limit = 50 } = req.query;

    let query = `
      SELECT r.*, p.name as project_name
      FROM reflections r
      LEFT JOIN projects p ON r.project_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (type) {
      query += ` AND r.type = $${paramIndex++}`;
      params.push(type);
    }

    if (project_id) {
      query += ` AND r.project_id = $${paramIndex++}`;
      params.push(project_id);
    }

    query += ` ORDER BY r.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json({ success: true, reflections: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get reflections', details: err.message });
  }
});

/**
 * POST /api/brain/reflections
 * Create a new reflection
 */
router.post('/reflections', async (req, res) => {
  try {
    const { type, title, content, project_id, source_task_id, source_goal_id, tags } = req.body;

    if (!type || !title) {
      return res.status(400).json({ success: false, error: 'type and title are required' });
    }

    const validTypes = ['issue', 'learning', 'improvement'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, error: `type must be one of: ${validTypes.join(', ')}` });
    }

    const result = await pool.query(`
      INSERT INTO reflections (type, title, content, project_id, source_task_id, source_goal_id, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [type, title, content, project_id, source_task_id, source_goal_id, tags]);

    res.json({ success: true, reflection: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create reflection', details: err.message });
  }
});

// ==================== Execution Logs API ====================

/**
 * GET /tasks/:taskId/logs
 * 获取任务执行日志
 */
router.get('/tasks/:taskId/logs', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { offset = 0, limit = 1000 } = req.query;

    // 1. Get task metadata to find log file path
    const taskResult = await pool.query(
      'SELECT id, title, metadata FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];
    const metadata = task.metadata || {};
    const logFile = metadata.log_file;

    if (!logFile) {
      return res.json({
        task_id: taskId,
        task_title: task.title,
        logs: [],
        message: 'No log file associated with this task'
      });
    }

    // 2. Read log file
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const logContent = await fs.readFile(logFile, 'utf-8');
      const lines = logContent.split('\n');

      // Apply pagination
      const start = parseInt(offset);
      const end = start + parseInt(limit);
      const paginatedLines = lines.slice(start, end);

      res.json({
        task_id: taskId,
        task_title: task.title,
        log_file: logFile,
        total_lines: lines.length,
        offset: start,
        limit: parseInt(limit),
        logs: paginatedLines
      });
    } catch (fileErr) {
      if (fileErr.code === 'ENOENT') {
        return res.json({
          task_id: taskId,
          task_title: task.title,
          log_file: logFile,
          logs: [],
          message: 'Log file not found on disk'
        });
      }
      throw fileErr;
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task logs', details: err.message });
  }
});

/**
 * GET /tasks/:taskId/checkpoints
 * 获取任务的 checkpoint 信息
 */
router.get('/tasks/:taskId/checkpoints', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Get task with metadata
    const taskResult = await pool.query(
      'SELECT id, title, status, metadata, created_at, started_at, completed_at FROM tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];
    const metadata = task.metadata || {};

    // Extract checkpoint-related information
    const checkpoints = [];

    // Add task lifecycle checkpoints
    if (task.created_at) {
      checkpoints.push({
        timestamp: task.created_at,
        event: 'task_created',
        status: 'queued'
      });
    }

    if (task.started_at) {
      checkpoints.push({
        timestamp: task.started_at,
        event: 'task_started',
        status: 'running'
      });
    }

    if (task.completed_at) {
      checkpoints.push({
        timestamp: task.completed_at,
        event: 'task_completed',
        status: task.status
      });
    }

    // Add any additional checkpoints from metadata
    if (metadata.checkpoints && Array.isArray(metadata.checkpoints)) {
      checkpoints.push(...metadata.checkpoints);
    }

    // Sort by timestamp
    checkpoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({
      task_id: taskId,
      task_title: task.title,
      current_status: task.status,
      checkpoints
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task checkpoints', details: err.message });
  }
});

// ==================== Hardening Status Dashboard ====================

/**
 * GET /api/brain/hardening/status
 * One-eye dashboard: aggregates all 6 stability hardening features
 */
router.get('/hardening/status', async (req, res) => {
  try {
    const version = '1.7.0';
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
      Promise.resolve(getAlertness()),

      // 7. Decay status (sync)
      Promise.resolve(getDecayStatus()),

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

    // Recovery gate calculation
    const currentLevel = alertness.level;
    let recoveryGate = null;
    if (currentLevel > 0) {
      const threshold = RECOVERY_THRESHOLDS[currentLevel];
      if (threshold) {
        const elapsed = Date.now() - new Date(alertness.last_change_at).getTime();
        const remaining = Math.max(0, threshold - elapsed);
        const targetLevel = currentLevel - 1;
        recoveryGate = {
          target: LEVEL_NAMES[targetLevel],
          remaining_ms: remaining,
        };
      }
    }

    // Compute overall_status: critical > warn > ok
    const systemicCount = parseInt(fRow.systemic);
    const backlogCount = parseInt(backlogCurrent.rows[0].count);
    let overall_status = 'ok';
    if (currentLevel >= 3 || systemicCount >= 5 || backlogCount >= EVENT_BACKLOG_THRESHOLD * 2) {
      overall_status = 'critical';
    } else if (currentLevel >= 1 || systemicCount >= 2 || backlogCount >= EVENT_BACKLOG_THRESHOLD || parseInt(pRow.pending) >= 3) {
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

export default router;
