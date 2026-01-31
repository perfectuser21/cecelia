 
import { Router } from 'express';
import { getSystemStatus, getRecentDecisions, getWorkingMemory, getActivePolicy, getTopTasks } from './orchestrator.js';
import { createSnapshot, getRecentSnapshots, getLatestSnapshot } from './perception.js';
import { createTask, updateTask, createGoal, updateGoal, triggerN8n, setMemory, batchUpdateTasks } from './actions.js';
import { getDailyFocus, setDailyFocus, clearDailyFocus, getFocusSummary } from './focus.js';
import { getTickStatus, enableTick, disableTick, executeTick, runTickSafe } from './tick.js';
import { parseIntent, parseAndCreate, INTENT_TYPES, INTENT_ACTION_MAP, extractEntities, classifyIntent, getSuggestedAction } from './intent.js';
import pool from '../task-system/db.js';
import { decomposeTRD, getTRDProgress, listTRDs } from './decomposer.js';
import { generatePrdFromTask, generateTrdFromGoal, PRD_TYPE_MAP } from './templates.js';
import { compareGoalProgress, generateDecision, executeDecision, getDecisionHistory, rollbackDecision } from './decision.js';
import { planNextTask, getPlanStatus, handlePlanInput } from './planner.js';
import { ensureEventsTable, queryEvents, getEventCounts } from './event-bus.js';
import { getState as getCBState, reset as resetCB, getAllStates as getAllCBStates } from './circuit-breaker.js';
import { emit as emitEvent } from './event-bus.js';
import { recordSuccess as cbSuccess, recordFailure as cbFailure } from './circuit-breaker.js';
import crypto from 'crypto';

const router = Router();

// ==================== 白名单配置 ====================

const ALLOWED_ACTIONS = {
  'create-task': {
    required: ['title'],
    optional: ['description', 'priority', 'project_id', 'goal_id', 'tags']
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
    optional: ['description', 'priority', 'project_id', 'target_date']
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
 * GET /api/brain/status/full
 * 完整状态（给人 debug 用）
 */
router.get('/status/full', async (req, res) => {
  try {
    const status = await getSystemStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get full status', details: err.message });
  }
});

/**
 * GET /api/brain/snapshot/latest
 */
router.get('/snapshot/latest', async (req, res) => {
  try {
    const snapshot = await getLatestSnapshot();
    if (snapshot) {
      res.json(snapshot);
    } else {
      res.status(404).json({ error: 'No snapshot found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to get snapshot', details: err.message });
  }
});

/**
 * GET /api/brain/snapshots
 */
router.get('/snapshots', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const snapshots = await getRecentSnapshots(limit);
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get snapshots', details: err.message });
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
    const limit = parseInt(req.query.limit) || 20;
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

// ==================== 动作执行 API（白名单 + 幂等） ====================

/**
 * POST /api/brain/snapshot
 */
router.post('/snapshot', async (req, res) => {
  try {
    const snapshot = await createSnapshot();
    if (snapshot) {
      res.json({ success: true, snapshot });
    } else {
      res.json({ success: true, message: 'Snapshot unchanged' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to create snapshot', details: err.message });
  }
});

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

    // 1. Update task status based on execution result
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

    // 3. Update task in database
    await pool.query(`
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

    // 4. Log the execution result
    await pool.query(`
      INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'execution-callback',
      `Task ${task_id} execution completed with status: ${status}`,
      { task_id, run_id, status, iterations },
      lastRunResult,
      status === 'AI Done' ? 'success' : 'failed'
    ]);

    console.log(`[execution-callback] Task ${task_id} updated to ${newStatus}`);

    // Record to EventBus and Circuit Breaker
    if (newStatus === 'completed') {
      await emitEvent('task_completed', 'executor', { task_id, run_id, duration_ms });
      await cbSuccess('cecelia-run');
    } else if (newStatus === 'failed') {
      await emitEvent('task_failed', 'executor', { task_id, run_id, status });
      await cbFailure('cecelia-run');
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

// ==================== Generate API ====================

/**
 * POST /api/brain/generate/prd
 * Generate a PRD from task description
 */
router.post('/generate/prd', async (req, res) => {
  try {
    const { title, description, type = 'feature' } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
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
    const { title, description, milestones = [] } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    const trd = generateTrdFromGoal({ title, description, milestones });

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

// ==================== TRD API ====================

/**
 * POST /api/brain/trd/decompose
 * Decompose a TRD into milestones, PRDs, and tasks
 */
router.post('/trd/decompose', async (req, res) => {
  try {
    const { trd_content, project_id, goal_id } = req.body;

    if (!trd_content) {
      return res.status(400).json({
        success: false,
        error: 'trd_content is required'
      });
    }

    const result = await decomposeTRD(trd_content, project_id, goal_id);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to decompose TRD',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/trd/:id/progress
 * Get progress for a specific TRD
 */
router.get('/trd/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;

    const progress = await getTRDProgress(id);

    res.json({
      success: true,
      ...progress
    });
  } catch (err) {
    if (err.message === 'TRD not found') {
      res.status(404).json({
        success: false,
        error: err.message
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to get TRD progress',
        details: err.message
      });
    }
  }
});

/**
 * GET /api/brain/trds
 * List all TRDs with progress
 */
router.get('/trds', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const trds = await listTRDs(limit);

    res.json({
      success: true,
      trds
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to list TRDs',
      details: err.message
    });
  }
});


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
 * Get real Claude process information using pgrep/ps
 */
router.get('/vps-slots', async (req, res) => {
  try {
    const MAX_SLOTS = 8;

    // Get Claude processes with details
    let slots = [];
    try {
      // Get all claude process PIDs and their details
      const { stdout } = await execAsync('ps aux | grep -E "^[^ ]+ +[0-9]+ .* claude" | grep -v grep');
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1]);
          const cpu = parts[2];
          const mem = parts[3];
          const startTime = parts[8];
          const command = parts.slice(10).join(' ');

          // Try to determine if this is a cecelia-run task
          let taskId = null;
          if (command.includes('cecelia-prds')) {
            const match = command.match(/prd-([a-f0-9-]+)/);
            taskId = match ? match[1] : null;
          }

          slots.push({
            pid,
            cpu: `${cpu}%`,
            memory: `${mem}%`,
            startTime,
            taskId,
            command: command.slice(0, 100) + (command.length > 100 ? '...' : '')
          });
        }
      }
    } catch {
      // No claude processes found
      slots = [];
    }

    res.json({
      success: true,
      total: MAX_SLOTS,
      used: slots.length,
      available: MAX_SLOTS - slots.length,
      slots
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

export default router;
