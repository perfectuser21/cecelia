 
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
  const result = await pool.query(`SELECT id, title, description, priority, status, project_id, queued_at, updated_at, due_at, custom_props FROM tasks WHERE status NOT IN ('completed', 'cancelled') ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC LIMIT $1`, [limit]);
  return result.rows;
}
async function getRecentDecisions(limit = 10) {
  const result = await pool.query(`SELECT id, ts, trigger, input_summary, llm_output_json, action_result_json, status FROM decision_log ORDER BY ts DESC LIMIT $1`, [limit]);
  return result.rows;
}
import { createTask, updateTask, createGoal, updateGoal, triggerN8n, setMemory, batchUpdateTasks } from './actions.js';
import { getDailyFocus, setDailyFocus, clearDailyFocus, getFocusSummary } from './focus.js';
import { getTickStatus, enableTick, disableTick, executeTick, runTickSafe, routeTask, drainTick, getDrainStatus, cancelDrain, TASK_TYPE_AGENT_MAP, getStartupErrors } from './tick.js';
import { identifyWorkType, getTaskLocation, routeTaskCreate, getValidTaskTypes, LOCATION_MAP } from './task-router.js';
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
import { compareGoalProgress, generateDecision, executeDecision, rollbackDecision } from './decision.js';
import { planNextTask, getPlanStatus, handlePlanInput, getGlobalState, selectTopAreas, selectActiveInitiativeForArea, ACTIVE_AREA_COUNT } from './planner.js';
import { ensureEventsTable, queryEvents, getEventCounts } from './event-bus.js';
import { getState as getCBState, reset as resetCB, getAllStates as getAllCBStates } from './circuit-breaker.js';
import { getCurrentAlertness, setManualOverride, clearManualOverride, evaluateAlertness, ALERTNESS_LEVELS, LEVEL_NAMES } from './alertness/index.js';

// Constants previously in old alertness.js, kept for hardening status route
const EVENT_BACKLOG_THRESHOLD = 50;
import { handleTaskFailure, getQuarantinedTasks, getQuarantineStats, releaseTask, quarantineTask, QUARANTINE_REASONS, REVIEW_ACTIONS, classifyFailure } from './quarantine.js';
import { publishTaskCreated, publishTaskCompleted, publishTaskFailed } from './events/taskEvents.js';
import { emit as emitEvent } from './event-bus.js';
import { recordSuccess as cbSuccess, recordFailure as cbFailure } from './circuit-breaker.js';
import { notifyTaskCompleted, notifyTaskFailed } from './notifier.js';
import { getAccountUsage, selectBestAccount } from './account-usage.js';
import websocketService, { WS_EVENTS } from './websocket.js';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from './thalamus.js';
import { executeDecision as executeThalamusDecision, getPendingActions, approvePendingAction, rejectPendingAction, addProposalComment, selectProposalOption, expireStaleProposals } from './decision-executor.js';
import { createProposal, approveProposal, rollbackProposal, rejectProposal, getProposal, listProposals } from './proposal.js';
import { generateTaskEmbeddingAsync } from './embedding-service.js';
import { handleChat } from './orchestrator-chat.js';
import { callLLM } from './llm-caller.js';
import { loadUserProfile, upsertUserProfile } from './user-profile.js';
import { getRealtimeConfig, handleRealtimeTool } from './orchestrator-realtime.js';
import { loadActiveProfile, getActiveProfile, switchProfile, listProfiles as listModelProfiles, updateAgentModel, batchUpdateAgentModels } from './model-profile.js';
import {
  runDecompositionChecks,
} from './decomposition-checker.js';
import {
  createSuggestion,
  executeTriage,
  getTopPrioritySuggestions,
  updateSuggestionStatus,
  cleanupExpiredSuggestions,
  getTriageStats
} from './suggestion-triage.js';

// Inventory config for decomposition routes (moved here after decomp-checker simplification)
const INVENTORY_CONFIG = { LOW_WATERMARK: 3, TARGET_READY_TASKS: 9, BATCH_SIZE: 3 };

async function getActiveExecutionPaths() {
  const result = await pool.query(`
    SELECT p.id, p.name, pkl.kr_id
    FROM projects p
    INNER JOIN project_kr_links pkl ON pkl.project_id = p.id
    WHERE p.type = 'initiative' AND p.status IN ('active', 'in_progress')
  `);
  return result.rows;
}
import { triggerCeceliaRun, checkCeceliaRunAvailable } from './executor.js';

const router = Router();
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

// 秋米 /decomp skill 内容（模块启动时加载一次，注入到 autumnrice/chat system prompt）
// 路径：容器内 volume 挂载路径与宿主机一致
let _decompSkillContent = '';
try {
  _decompSkillContent = readFileSync(
    '/home/xx/perfect21/cecelia/packages/workflows/skills/decomp/SKILL.md', 'utf-8'
  );
  console.log('[autumnrice] decomp SKILL.md loaded:', _decompSkillContent.length, 'chars');
} catch (e) {
  console.warn('[autumnrice] decomp SKILL.md not found, using basic persona:', e.message);
}

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

    const [policy, workingMemory, topTasks, recentDecisions, dailyFocus] = await Promise.all([
      getActivePolicy(),
      getWorkingMemory(),
      getTopTasks(10),
      getRecentDecisions(5),
      getFocusSummary()
    ]);
    const snapshot = null;

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
    const today = new Date().toISOString().split('T')[0];
    const [workingMemory, topTasks, recentDecisionsData, policy, tickStatus, todayTaskStats] = await Promise.all([
      getWorkingMemory(),
      getTopTasks(10),
      getRecentDecisions(3),
      getActivePolicy(),
      getTickStatus(),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed' AND updated_at::date = $1::date) AS completed_today,
          COUNT(*) FILTER (WHERE status = 'failed' AND updated_at::date = $1::date) AS failed_today,
          COUNT(*) FILTER (WHERE status = 'queued') AS queued,
          COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress
        FROM tasks
      `, [today])
    ]);
    const taskRow = todayTaskStats.rows[0] || {};
    const snapshot = null;
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
      },
      task_stats: {
        completed_today: parseInt(taskRow.completed_today || 0),
        failed_today: parseInt(taskRow.failed_today || 0),
        queued: parseInt(taskRow.queued || 0),
        in_progress: parseInt(taskRow.in_progress || 0)
      },
      task_queue: {
        queued: parseInt(taskRow.queued || 0)
      },
      tick_stats: {
        actions_today: tickStatus.actions_today || 0,
        last_tick_at: tickStatus.last_tick || null,
        interval_minutes: tickStatus.interval_minutes || 5
      },
      token_stats: {
        today_usd: 0
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

/**
 * GET /api/brain/goals
 * 查询 goals 列表，支持按部门过滤
 * Query params:
 *   dept: 按 metadata->>'dept' 过滤（可选）
 */
router.get('/goals', async (req, res) => {
  try {
    const { dept } = req.query;
    let query = `
      SELECT id, title, type, status, priority, progress, weight, parent_id, metadata, custom_props, created_at, updated_at
      FROM goals
    `;
    const params = [];
    if (dept) {
      query += ` WHERE metadata->>'dept' = $1`;
      params.push(dept);
    }
    query += ` ORDER BY priority ASC, created_at DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goals', details: err.message });
  }
});

/**
 * POST /api/brain/goals/:id/approve
 * 用户放行 KR（reviewing → ready）。
 * 只有 type='kr' 且 status='reviewing' 的 goal 可以被放行。
 */
router.post('/goals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE goals SET status = 'ready', updated_at = NOW()
       WHERE id = $1 AND type = 'kr' AND status = 'reviewing'
       RETURNING id, title, status`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'KR not found or not in reviewing status'
      });
    }

    console.log(`[goals] KR ${id} approved: reviewing → ready`);

    res.json({
      success: true,
      goal: result.rows[0],
      message: `KR "${result.rows[0].title}" 已放行`
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve KR', details: err.message });
  }
});

// ==================== Task Feedback & Status API (Phase 4b) ====================

/**
 * POST /api/brain/tasks/:task_id/feedback
 * 接收 Engine 上传的任务执行反馈
 */
router.post('/tasks/:task_id/feedback', async (req, res) => {
  try {
    const { task_id } = req.params;

    // Support two formats:
    // 1. Flat: { status, summary, issues_found, next_steps_suggested, ... }
    // 2. Wrapped: { feedback: { summary, issues_found, next_steps_suggested, ... } }
    //    (generated by packages/engine/skills/dev/scripts/upload-feedback.sh)
    const body = req.body.feedback && typeof req.body.feedback === 'object'
      ? req.body.feedback
      : req.body;

    const {
      status: rawStatus,
      summary,
      metrics,
      artifacts,
      issues,
      learnings,
      issues_found,
      next_steps_suggested,
    } = body;

    // status is optional — default to 'completed' for compatibility with
    // generate-feedback-report.sh which does not include a status field.
    const status = rawStatus || 'completed';

    // summary is still required
    if (!summary) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        code: 'MISSING_FIELD',
        required: ['summary']
      });
    }

    // Validate status value
    if (!['completed', 'failed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value',
        code: 'INVALID_STATUS',
        allowed: ['completed', 'failed']
      });
    }

    // Check if task exists (also fetch goal_id for suggestion metadata)
    const taskResult = await pool.query(
      'SELECT id, status, goal_id FROM tasks WHERE id = $1',
      [task_id]
    );
    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
        code: 'TASK_NOT_FOUND'
      });
    }

    const task = taskResult.rows[0];

    // Validate task status (must be in_progress or completed to receive feedback)
    if (!['in_progress', 'completed', 'failed'].includes(task.status)) {
      return res.status(400).json({
        success: false,
        error: 'Task must be in_progress, completed, or failed to receive feedback',
        code: 'INVALID_TASK_STATUS',
        current_status: task.status
      });
    }

    // Generate unique feedback ID
    const feedbackId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();

    // Construct feedback object
    const feedback = {
      id: feedbackId,
      status,
      summary,
      ...(metrics && { metrics }),
      ...(artifacts && { artifacts }),
      ...(issues && { issues }),
      ...(learnings && { learnings }),
      ...(issues_found && { issues_found }),
      ...(next_steps_suggested && { next_steps_suggested }),
      received_at: receivedAt
    };

    // Append to feedback array and increment count
    await pool.query(`
      UPDATE tasks
      SET
        feedback = feedback || $1::jsonb,
        feedback_count = feedback_count + 1,
        updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify([feedback]), task_id]);

    // ── Magentic-One: Agent Findings → Suggestions (best-effort) ────────────
    // Convert issues_found and next_steps_suggested into suggestions table entries
    // so that Suggestion Triage and Goal Outer Loop can act on agent findings.
    let suggestionsCreated = 0;
    try {
      const suggestionItems = [
        ...((Array.isArray(issues_found) ? issues_found : []).map(content => ({
          content: String(content),
          suggestion_type: 'issue',
          priority_score: 0.75,
        }))),
        ...((Array.isArray(next_steps_suggested) ? next_steps_suggested : []).map(content => ({
          content: String(content),
          suggestion_type: 'next_step',
          priority_score: 0.55,
        }))),
      ];

      for (const item of suggestionItems) {
        // Idempotency: skip if a suggestion with the same feedback_id and content already exists
        const existing = await pool.query(
          `SELECT id FROM suggestions
           WHERE source = 'agent_feedback'
             AND metadata->>'feedback_id' = $1
             AND content = $2
           LIMIT 1`,
          [feedbackId, item.content]
        );
        if (existing.rows.length > 0) continue;

        await pool.query(
          `INSERT INTO suggestions
             (content, priority_score, source, agent_id, suggestion_type,
              target_entity_type, target_entity_id, metadata)
           VALUES ($1, $2, 'agent_feedback', 'dev', $3, 'task', $4, $5)`,
          [
            item.content,
            item.priority_score,
            item.suggestion_type,
            task_id,
            JSON.stringify({
              feedback_id: feedbackId,
              task_id,
              goal_id: task.goal_id || null,
            }),
          ]
        );
        suggestionsCreated++;
      }

      if (suggestionsCreated > 0) {
        console.log(`[feedback] Task ${task_id}: created ${suggestionsCreated} suggestion(s) from agent findings`);
      }
    } catch (suggErr) {
      // Suggestions creation is best-effort — log but don't fail the request
      console.error(`[feedback] Suggestions creation failed (non-fatal): ${suggErr.message}`);
    }
    // ────────────────────────────────────────────────────────────────────────

    res.json({
      success: true,
      task_id,
      feedback_id: feedbackId,
      received_at: receivedAt,
      suggestions_created: suggestionsCreated,
    });
  } catch (err) {
    console.error('Failed to store feedback:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to store feedback',
      code: 'DATABASE_ERROR',
      details: err.message
    });
  }
});

/**
 * PATCH /api/brain/tasks/:task_id
 * 更新任务状态（Engine 调用）
 */
router.patch('/tasks/:task_id', async (req, res) => {
  try {
    const { task_id } = req.params;
    const { status } = req.body;

    // Validate status field
    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: status',
        code: 'MISSING_FIELD'
      });
    }

    // Validate status value (only allow specific transitions)
    const allowedStatuses = ['in_progress', 'completed', 'failed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value',
        code: 'INVALID_STATUS',
        allowed: allowedStatuses
      });
    }

    // Get current task
    const taskResult = await pool.query('SELECT id, status FROM tasks WHERE id = $1', [task_id]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
        code: 'TASK_NOT_FOUND'
      });
    }

    const task = taskResult.rows[0];
    const currentStatus = task.status;

    // Define allowed transitions
    const allowedTransitions = {
      'pending': ['in_progress'],
      'in_progress': ['completed', 'failed'],
      'completed': [],  // Cannot change from completed
      'failed': []      // Cannot change from failed
    };

    // Validate transition
    if (!allowedTransitions[currentStatus]?.includes(status)) {
      return res.status(409).json({
        success: false,
        error: 'Invalid status transition',
        code: 'INVALID_TRANSITION',
        current_status: currentStatus,
        requested_status: status,
        allowed: allowedTransitions[currentStatus] || []
      });
    }

    // Construct status history entry
    const changedAt = new Date().toISOString();
    const historyEntry = {
      from: currentStatus,
      to: status,
      changed_at: changedAt,
      source: 'engine'
    };

    // Update task status and record history
    const updateResult = await pool.query(`
      UPDATE tasks
      SET
        status = $1,
        status_history = status_history || $2::jsonb,
        updated_at = NOW()
      WHERE id = $3
      RETURNING status, updated_at
    `, [status, JSON.stringify([historyEntry]), task_id]);

    const updatedTask = updateResult.rows[0];

    // Emit event for status change
    await emitEvent('task_status_changed', {
      task_id,
      from: currentStatus,
      to: status,
      source: 'engine',
      timestamp: changedAt
    });

    res.json({
      success: true,
      task_id,
      status: updatedTask.status,
      updated_at: updatedTask.updated_at
    });
  } catch (err) {
    console.error('Failed to update task status:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update task status',
      code: 'DATABASE_ERROR',
      details: err.message
    });
  }
});

// ==================== Briefing API ====================

/**
 * GET /api/brain/briefing
 * 一站式简报数据聚合，前端打开页面时调用一次
 * Query: since (ISO timestamp, 默认 24h 前)
 */
router.get('/briefing', async (req, res) => {
  try {
    const { getBriefing } = await import('./briefing.js');
    const briefing = await getBriefing({ since: req.query.since });
    res.json(briefing);
  } catch (err) {
    console.error('[API] briefing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==================== Greet API（主动问候） ====================

/**
 * POST /api/brain/greet
 * 用户打开 Dashboard 时调用，触发 Cecelia 主动问候。
 * 通过 WebSocket DESIRE_EXPRESSED 推送问候到前端。
 * 5 分钟冷却期防止重复生成。
 */
router.post('/greet', async (req, res) => {
  try {
    const { generateGreeting, isInCooldown } = await import('./greet.js');

    // 冷却检查（提前返回，不需要生成）
    if (await isInCooldown()) {
      // 即使冷却期，也更新 user_last_seen
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ('user_last_seen', $1, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
      `, [JSON.stringify(new Date().toISOString())]);
      return res.json({ status: 'cooldown', message: '5 分钟内已问候过' });
    }

    // 异步生成问候（不阻塞响应）
    res.json({ status: 'generating' });

    // 在响应后异步生成并推送
    const greeting = await generateGreeting();
    if (greeting) {
      // 通过 WebSocket 推送
      websocketService.broadcast(WS_EVENTS.DESIRE_EXPRESSED, {
        id: `greet-${Date.now()}`,
        type: greeting.type,
        urgency: greeting.urgency,
        content: greeting.message,
        message: greeting.message,
        source: 'greet',
        timestamp: new Date().toISOString(),
      });
      console.log('[greet] 主动问候已推送:', greeting.message.slice(0, 60));
    }
  } catch (err) {
    console.error('[API] greet error:', err.message);
    // 如果还没发送响应
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
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

// ==================== Hello API (Test Endpoint) ====================

/**
 * GET /api/brain/hello
 * Returns a simple Hello Cecelia message
 */
router.get('/hello', async (req, res) => {
  try {
    res.json({
      message: "Hello Cecelia",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to say hello', details: err.message });
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

// ==================== Drain API ====================

/**
 * POST /api/brain/tick/drain
 * Graceful drain — stop dispatching new tasks, let in_progress finish
 */
router.post('/tick/drain', async (req, res) => {
  try {
    const result = await drainTick();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start drain', details: err.message });
  }
});

/**
 * GET /api/brain/tick/drain-status
 * Check drain progress
 */
router.get('/tick/drain-status', async (req, res) => {
  try {
    const result = await getDrainStatus();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get drain status', details: err.message });
  }
});

/**
 * POST /api/brain/tick/drain-cancel
 * Cancel drain mode, resume normal dispatching
 */
router.post('/tick/drain-cancel', (req, res) => {
  try {
    const result = cancelDrain();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel drain', details: err.message });
  }
});

/**
 * GET /api/brain/tick/startup-errors
 * 获取 Tick 启动错误历史，用于诊断 Brain 是否在启动时遇到问题
 */
router.get('/tick/startup-errors', async (req, res) => {
  try {
    const data = await getStartupErrors();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get startup errors', details: err.message });
  }
});

// ==================== Alertness API ====================

/**
 * GET /api/brain/alertness
 * 获取当前警觉级别和状态
 */
router.get('/alertness', async (req, res) => {
  try {
    const alertness = getCurrentAlertness();
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
 * Body: { level: 0-4, reason: "string", duration_minutes?: 30 }
 *
 * Levels: SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4
 */
router.post('/alertness/override', async (req, res) => {
  try {
    const { level, reason, duration_minutes = 30 } = req.body;

    if (level === undefined || level < 0 || level > 4) {
      return res.status(400).json({ error: 'level must be 0-4 (SLEEPING=0, CALM=1, AWARE=2, ALERT=3, PANIC=4)' });
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
    const alertness = getCurrentAlertness();

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

/**
 * GET /api/brain/alertness/metrics
 * 获取最近的系统指标
 */
router.get('/alertness/metrics', async (req, res) => {
  try {
    const { getCurrentAlertness, getMetrics } = await import('./alertness/index.js');
    const metrics = await getMetrics();
    const alertness = getCurrentAlertness();

    res.json({
      success: true,
      alertness: alertness.levelName,
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get metrics', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/history
 * 获取历史趋势数据
 */
router.get('/alertness/history', async (req, res) => {
  try {
    const { getHistory } = await import('./alertness/index.js');
    const minutes = parseInt(req.query.minutes || '60', 10);
    const history = await getHistory(minutes);

    res.json({
      success: true,
      minutes,
      count: history.length,
      history
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get history', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/diagnosis
 * 获取当前诊断结果
 */
router.get('/alertness/diagnosis', async (req, res) => {
  try {
    const { getDiagnosis } = await import('./alertness/index.js');
    const diagnosis = getDiagnosis();

    res.json({
      success: true,
      diagnosis: diagnosis || { issues: [], severity: 'none', summary: 'No diagnosis available' }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get diagnosis', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/escalation
 * 获取升级响应状态
 */
router.get('/alertness/escalation', async (req, res) => {
  try {
    const { getEscalationStatus } = await import('./alertness/escalation.js');
    const status = getEscalationStatus();

    res.json({
      success: true,
      escalation: status
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get escalation status', details: err.message });
  }
});

/**
 * GET /api/brain/alertness/healing
 * 获取自愈恢复状态
 */
router.get('/alertness/healing', async (req, res) => {
  try {
    const { getRecoveryStatus } = await import('./alertness/healing.js');
    const status = getRecoveryStatus();

    res.json({
      success: true,
      healing: status
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get healing status', details: err.message });
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

// ==================== Session Tracking API ====================

/**
 * GET /api/brain/session/stats
 * 返回当前 session 开始时间、已运行分钟数、历史 session 记录（最近 10 条）
 * 用于分析 Anthropic spending cap 周期
 */
router.get('/session/stats', async (req, res) => {
  try {
    const { getSessionInfo } = await import('./executor.js');
    const current = getSessionInfo();

    // 查询最近 10 条历史 session 记录
    const historyResult = await pool.query(`
      SELECT payload, created_at
      FROM cecelia_events
      WHERE event_type = 'session_end'
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const history = historyResult.rows.map(row => ({
      ...row.payload,
      recorded_at: row.created_at,
    }));

    res.json({
      success: true,
      current,
      history,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get session stats', details: err.message });
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
 * GET /api/brain/pending-actions/:id
 * 获取单个 pending action 详情
 */
router.get('/pending-actions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM pending_actions WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, action: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get pending action', details: err.message });
  }
});

/**
 * PATCH /api/brain/pending-actions/:id/context
 * 更新 pending action 的 context 字段（UI 内联编辑用）
 * Body: { initiatives: string[] }
 */
router.patch('/pending-actions/:id/context', async (req, res) => {
  try {
    const { id } = req.params;
    const { initiatives } = req.body || {};
    if (!Array.isArray(initiatives)) {
      return res.status(400).json({ error: 'initiatives must be an array' });
    }
    const result = await pool.query(
      `UPDATE pending_actions
       SET context = context || jsonb_build_object('initiatives', $1::jsonb),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, context`,
      [JSON.stringify(initiatives), id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, action: result.rows[0] });
  } catch (err) {
    console.error('[PATCH /pending-actions/:id/context]', err);
    res.status(500).json({ error: 'Failed to update context', details: err.message });
  }
});

/**
 * GET /api/brain/pending-actions/:id/versions
 * 查询同一 KR 的所有 okr_decomp_review 版本历史
 */
router.get('/pending-actions/:id/versions', async (req, res) => {
  try {
    const { id } = req.params;
    const current = await pool.query(
      `SELECT context FROM pending_actions WHERE id = $1`,
      [id]
    );
    const ctx = current.rows[0]?.context || {};
    // 优先用 kr_id，没有则用 kr_title 匹配同一 KR 的所有版本
    let versions;
    if (ctx.kr_id) {
      versions = await pool.query(
        `SELECT id, context, status, created_at FROM pending_actions
         WHERE action_type = 'okr_decomp_review' AND context->>'kr_id' = $1
         ORDER BY created_at ASC`,
        [ctx.kr_id]
      );
    } else if (ctx.kr_title) {
      versions = await pool.query(
        `SELECT id, context, status, created_at FROM pending_actions
         WHERE action_type = 'okr_decomp_review' AND context->>'kr_title' = $1
         ORDER BY created_at ASC`,
        [ctx.kr_title]
      );
    } else {
      return res.json({ success: true, versions: [] });
    }
    res.json({ success: true, versions: versions.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get versions', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions
 * 创建新的 pending action（部门主管向 Cecelia 提案）
 * Body: { action_type, requester, context? }
 */
router.post('/pending-actions', async (req, res) => {
  try {
    const { action_type, requester, context } = req.body || {};
    if (!action_type || !requester) {
      return res.status(400).json({ error: 'action_type and requester are required' });
    }
    const result = await pool.query(`
      INSERT INTO pending_actions
        (action_type, params, context, status, source, comments)
      VALUES ($1, '{}', $2, 'pending_approval', 'repo-lead', '[]'::jsonb)
      RETURNING id, action_type, status, source, created_at
    `, [action_type, JSON.stringify({ requester, ...(context || {}) })]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create pending action', details: err.message });
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

/**
 * POST /api/brain/pending-actions/:id/comment
 * 追加评论到提案对话
 * Body: { text: string, role?: 'user'|'cecelia' }
 */
router.post('/pending-actions/:id/comment', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, role } = req.body || {};

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await addProposalComment(id, text.trim(), role || 'user');
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment', details: err.message });
  }
});

/**
 * POST /api/brain/pending-actions/:id/select
 * 选择提案选项并执行
 * Body: { option_id: string, reviewer?: string }
 */
router.post('/pending-actions/:id/select', async (req, res) => {
  try {
    const { id } = req.params;
    const { option_id, reviewer } = req.body || {};

    if (!option_id) {
      return res.status(400).json({ error: 'option_id is required' });
    }

    const result = await selectProposalOption(id, option_id, reviewer || 'dashboard-user');
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({ success: true, execution_result: result.execution_result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to select option', details: err.message });
  }
});

/**
 * POST /api/brain/autumnrice/chat
 * 与秋米直接对话，讨论 OKR 拆解结果
 * Body: { pending_action_id: string, message: string }
 * 秋米加载 KR + 拆解上下文，回复用户，并将对话存入 pending_actions.comments
 */
router.post('/autumnrice/chat', async (req, res) => {
  try {
    const { pending_action_id, message } = req.body || {};

    if (!pending_action_id || !message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'pending_action_id and message are required' });
    }

    // 加载 pending_action（含拆解上下文和历史对话）
    const actionResult = await pool.query(
      `SELECT id, context, params, comments, status FROM pending_actions WHERE id = $1`,
      [pending_action_id]
    );
    if (actionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pending action not found' });
    }

    const action = actionResult.rows[0];
    if (action.status !== 'pending_approval') {
      return res.status(400).json({ error: 'Pending action already processed' });
    }

    const ctx = action.context || {};
    const initiatives = Array.isArray(ctx.initiatives) ? ctx.initiatives : [];
    const existingComments = Array.isArray(action.comments) ? action.comments : [];

    // 新版本意图检测（在构建 prompt 之前，以便调整 prompt 格式）
    const NEW_VERSION_TRIGGERS = ['写一个新版本', '写新版本', '生成新版本', '给我新版本', '写一版新的', '帮我写个新版本', '写一个新的', '新的一个版本', '一个新版本', '试试新版', '新版方案', '重新写个版本', '换个版本', '再写一版'];
    const isNewVersion = NEW_VERSION_TRIGGERS.some(kw => message.includes(kw));

    const versionCreationSection = isNewVersion ? `

## 当前任务：生成新版本 Initiative 列表

用户希望你直接创建一个新版本，系统会自动保存到数据库，在左侧展示。
请以严格 JSON 格式回复（只输出 JSON，无其他文字）：
{"initiatives": ["Initiative 名称 1", "Initiative 名称 2"], "message": "新版本已在左侧展示，请查看"}

要求：
- initiatives 数组包含 3-6 个 Initiative，基于 KR 目标和现有版本进行优化
- 保留合理的部分，改进不足的部分，或根据用户的具体要求调整
- message 字段 30 字以内，告诉用户新版本已展示
- 输出必须是合法 JSON，不要有任何其他文字` : '';

    // 构建秋米的 system prompt + 对话历史
    const initiativeList = initiatives.length > 0
      ? initiatives.map((name, i) => `  ${i + 1}. ${name}`).join('\n')
      : '  （暂无 Initiative）';

    const decompSkillBlock = _decompSkillContent
      ? `# 你的核心技能（/decomp Skill 完整版）\n\n${_decompSkillContent}\n\n---\n\n`
      : '';

    const systemPrompt = `${decompSkillBlock}你是秋米（autumnrice），Cecelia 系统中的 OKR 拆解专家。上面是你的 /decomp 技能全文。

你刚刚完成了以下 OKR 拆解工作：

**KR（关键结果）**：${ctx.kr_title || '未知'}
**Project（项目）**：${ctx.project_name || '未知'}
**Initiatives（执行项）**：
${initiativeList}

用户现在直接来找你，对这个拆解有疑问或修改意见。请：
1. 用你的 /decomp 专业能力认真倾听并回应用户意见
2. 解释你的拆解思路和依据（引用 /decomp 的原则）
3. 如需调整，提出具体的新方案（符合 /decomp 的层级规范）
4. 保持专业、简洁、务实的风格
5. 用户满意时引导他们点击"确认放行"

## 重要能力：你可以触发重新拆解

**如果用户要求重新拆解**（说"重新拆"、"重拆"、"重做"、"再拆一次"等），你有能力触发重拆：
- 系统会自动检测这些关键词，重置 KR 状态，下一个 Tick 会启动新一轮完整拆解
- 你的回复应告诉用户："已为你触发重拆，系统正在重新分析，新版本完成后会出现在版本历史中，请稍等片刻"
- 重拆后当前这个版本不会消失，新版本会作为独立卡片出现

注意：你是秋米，不是 Cecelia。直接以秋米的身份回应。${versionCreationSection}`;

    // 构建历史对话
    const historyParts = existingComments
      .filter(c => c.role === 'user' || c.role === 'autumnrice')
      .map(c => {
        const roleLabel = c.role === 'user' ? '用户' : '秋米';
        const content = c.text || c.content || '';
        return `${roleLabel}：${content}`;
      });

    const historyBlock = historyParts.length > 0
      ? `\n## 之前的对话\n${historyParts.join('\n\n')}\n\n`
      : '';

    const fullPrompt = `${systemPrompt}${historyBlock}\n## 用户最新消息\n${message.trim()}\n\n请回复用户（直接输出回复内容，不要输出"秋米："前缀）：`;

    // 调用 LLM（秋米使用 claude-sonnet-4-6，含历史对话，timeout 90s）
    const { text: reply } = await callLLM('autumnrice', fullPrompt, {
      model: 'claude-sonnet-4-6',
      timeout: 90000,
      maxTokens: isNewVersion ? 1200 : 800,
    });

    // 新版本意图：解析 LLM JSON 响应，创建新 pending_action
    let finalReply = reply;
    let versionCreated = false;
    let newVersionId = null;

    if (isNewVersion) {
      try {
        const jsonMatch = reply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const newInitiatives = Array.isArray(parsed.initiatives) ? parsed.initiatives : [];
          if (parsed.message) finalReply = parsed.message;
          if (newInitiatives.length > 0) {
            const insertResult = await pool.query(
              `INSERT INTO pending_actions (action_type, context, params, status, comments, created_at, updated_at)
               VALUES ($1, $2::jsonb, $3::jsonb, 'pending_approval', '[]'::jsonb, NOW(), NOW())
               RETURNING id`,
              [
                action.action_type,
                JSON.stringify({ ...ctx, initiatives: newInitiatives }),
                JSON.stringify(action.params || {}),
              ]
            );
            newVersionId = insertResult.rows[0].id;
            versionCreated = true;
            console.log(`[autumnrice/chat] new version created: ${newVersionId} (${newInitiatives.length} initiatives)`);
          }
        }
      } catch (parseErr) {
        console.warn('[autumnrice/chat] new version parse failed:', parseErr.message);
        // finalReply 保持原始 reply，降级为普通回复
      }
    }

    const now = new Date().toISOString();
    const userComment = { role: 'user', text: message.trim(), ts: now };
    const autumnriceComment = { role: 'autumnrice', text: finalReply, ts: now };

    // 存入 pending_actions.comments
    await pool.query(
      `UPDATE pending_actions SET comments = comments || $1::jsonb WHERE id = $2 AND status = 'pending_approval'`,
      [JSON.stringify([userComment, autumnriceComment]), pending_action_id]
    );

    // 重拆意图检测（与 isNewVersion 互斥，避免同时触发两种流程）
    const REDECOMP_TRIGGERS = ['重新拆', '重拆', '重做', '重新分析', '重新规划', '再拆一次'];
    const isRedecomp = !isNewVersion && REDECOMP_TRIGGERS.some(kw => message.includes(kw));

    let redecompTriggered = false;
    if (isRedecomp) {
      // 优先用 context.kr_id，没有则用 kr_title 反查
      let krId = action.context?.kr_id;
      if (!krId && action.context?.kr_title) {
        const krResult = await pool.query(
          `SELECT id FROM goals WHERE title = $1 AND type = 'kr' LIMIT 1`,
          [action.context.kr_title]
        );
        if (krResult.rows.length > 0) krId = krResult.rows[0].id;
      }
      if (krId) {
        await pool.query(
          `UPDATE goals SET status='ready', updated_at=NOW() WHERE id=$1 AND type='kr'`,
          [krId]
        );
        redecompTriggered = true;
        console.log(`[autumnrice/chat] redecomp triggered for KR: ${krId}`);
      } else {
        console.warn(`[autumnrice/chat] redecomp: could not find KR for action ${pending_action_id}`);
      }
    }

    res.json({ success: true, reply: finalReply, comment: autumnriceComment, redecomp_triggered: redecompTriggered, version_created: versionCreated, new_version_id: newVersionId });
  } catch (err) {
    console.error('[autumnrice/chat] Error:', err.message);
    res.status(500).json({ error: 'Failed to chat with autumnrice', details: err.message });
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
 * POST /api/brain/action/create-initiative
 * Create an Initiative (写入 projects 表, type='initiative', parent_id 指向 Project)
 * 秋米专用：拆解 KR 时创建 Initiative
 */
router.post('/action/create-initiative', async (req, res) => {
  try {
    const { name, parent_id, kr_id, decomposition_mode, description, plan_content } = req.body;

    if (!name || !parent_id) {
      return res.status(400).json({
        success: false,
        error: 'name and parent_id are required'
      });
    }

    const { createInitiative } = await import('./actions.js');
    const result = await createInitiative({
      name,
      parent_id,
      kr_id,
      decomposition_mode: decomposition_mode || 'known',
      description,
      plan_content
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to create initiative',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/action/create-project
 * Create a Project (写入 projects 表, type='project')
 */
router.post('/action/create-project', async (req, res) => {
  try {
    const { name, description, repo_path, repo_paths, kr_ids } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      });
    }

    const { createProject } = await import('./actions.js');
    const result = await createProject({
      name,
      description,
      repo_path,
      repo_paths,
      kr_ids
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to create project',
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

    // P1-1: Dev task completed without PR → completed_no_pr
    // Only dev tasks are expected to produce PRs. Decomposition tasks are exempt.
    if (newStatus === 'completed' && !pr_url) {
      try {
        const taskRow = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const taskType = taskRow.rows[0]?.task_type;
        const isDecomposition = taskRow.rows[0]?.payload?.decomposition;
        if (taskType === 'dev' && !isDecomposition) {
          newStatus = 'completed_no_pr';
          console.warn(`[execution-callback] Dev task ${task_id} completed without PR → completed_no_pr`);
        }
      } catch (prCheckErr) {
        console.error(`[execution-callback] PR check error (non-fatal): ${prCheckErr.message}`);
      }
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
      result_summary: (result !== null && typeof result === 'object') ? result.result : result
    };

    // 3. ATOMIC: DB update + activeProcess cleanup in a single transaction
    //    This eliminates the race window where tick could see stale state.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update task in database (idempotency: only update if still in_progress)
      // Note: $6 (isCompleted) avoids reusing $2 in CASE WHEN, which causes
      // "inconsistent types deduced for parameter $2" (text vs character varying).
      const isCompleted = newStatus === 'completed';

      // Extract findings from result for storage in payload.
      // decomp-checker reads payload.findings to pass context to follow-up tasks.
      // result can be a string (text output) or an object with a findings/result field.
      const findingsRaw = (result !== null && typeof result === 'object')
        ? (result.findings || result.result || result)
        : result;
      const findingsValue = findingsRaw
        ? (typeof findingsRaw === 'string' ? findingsRaw : JSON.stringify(findingsRaw))
        : null;

      if (!findingsValue && isCompleted) {
        console.warn(`[execution-callback] Task ${task_id} completed with empty findings/result`);
      }

      await client.query(`
        UPDATE tasks
        SET
          status = $2,
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
            'last_run_result', $3::jsonb,
            'run_status', $4::text,
            'pr_url', $5::text
          ) || CASE WHEN $7::text IS NOT NULL THEN jsonb_build_object('findings', $7::text) ELSE '{}'::jsonb END,
          completed_at = CASE WHEN $6 THEN NOW() ELSE completed_at END
        WHERE id = $1 AND status = 'in_progress'
      `, [task_id, newStatus, JSON.stringify(lastRunResult), status, pr_url || null, isCompleted, findingsValue]);

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

      // Record progress step for completed execution
      try {
        const { recordProgressStep } = await import('./progress-ledger.js');
        await recordProgressStep(task_id, run_id, {
          sequence: 1, // 简化版：每个任务记录为单步骤
          name: 'task_execution',
          type: 'execution',
          status: status === 'AI Done' ? 'completed' : 'failed',
          startedAt: null, // execution-callback 时不知道开始时间
          completedAt: new Date(),
          durationMs: duration_ms || null,
          inputSummary: null,
          outputSummary: findingsValue ? findingsValue.substring(0, 500) : null,
          findings: result && typeof result === 'object' ? result : {},
          errorCode: status !== 'AI Done' ? 'execution_failed' : null,
          errorMessage: status !== 'AI Done' ? `Task execution failed with status: ${status}` : null,
          retryCount: iterations || 0,
          artifacts: { pr_url: pr_url || null },
          metadata: {
            checkpoint_id: checkpoint_id || null,
            original_status: status
          },
          confidenceScore: status === 'AI Done' ? 1.0 : 0.2
        });
        console.log(`[execution-callback] Progress step recorded for task ${task_id}`);
      } catch (progressErr) {
        // Progress ledger errors should not break the main flow
        console.error(`[execution-callback] Progress step recording failed: ${progressErr.message}`);
      }

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

      // Generate embedding for completed task (async, fire-and-forget)
      {
        const taskRow = await pool.query('SELECT title, description FROM tasks WHERE id = $1', [task_id]);
        if (taskRow.rows[0]) {
          generateTaskEmbeddingAsync(task_id, taskRow.rows[0].title, taskRow.rows[0].description).catch(() => {});
        }
      }

      // 闭环回写：dev 任务完成后，将相关 failure_pattern 的 memory_stream 标记为 resolved
      resolveRelatedFailureMemories(task_id, pool).catch(err =>
        console.warn(`[execution-callback] Closure resolve failed (non-fatal): ${err.message}`)
      );
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
        // Note: typeof null === 'object', so we must check result !== null first
        // to avoid TypeError when result is null (e.g. claude CLI fails with Spending cap reached)
        const errorMsg = (result !== null && typeof result === 'object')
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

    // 5b. 探索型任务闭环已移除
    if (newStatus === 'completed') {

      // 5c1. Decomp Review 闭环：Vivian 审查完成 → 激活/修正/拒绝
      try {
        const decompReviewResult = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const decompReviewRow = decompReviewResult.rows[0];

        if (decompReviewRow?.task_type === 'decomp_review') {
          console.log(`[execution-callback] Decomp review task completed, processing verdict...`);

          // 从 result 中提取 verdict 和 findings
          const verdictRaw = (result !== null && typeof result === 'object')
            ? (result.verdict || result.result?.verdict)
            : null;
          const findingsRaw = (result !== null && typeof result === 'object')
            ? (result.findings || result.result?.findings || result)
            : {};

          // verdict 归一化
          const validVerdicts = ['approved', 'needs_revision', 'rejected'];
          const verdict = validVerdicts.includes(verdictRaw) ? verdictRaw : 'approved';

          const { processReviewResult } = await import('./review-gate.js');
          await processReviewResult(pool, task_id, verdict, findingsRaw);

          // 计划调整：如果 findings 包含 plan_adjustment，执行调整
          if (findingsRaw?.plan_adjustment && decompReviewRow?.payload?.review_scope === 'plan_adjustment') {
            try {
              const { executePlanAdjustment } = await import('./progress-reviewer.js');
              await executePlanAdjustment(pool, findingsRaw, decompReviewRow.payload?.plan_context);
              console.log(`[execution-callback] Plan adjustment executed for project ${decompReviewRow.payload?.entity_id}`);
            } catch (adjErr) {
              console.error(`[execution-callback] Plan adjustment error: ${adjErr.message}`);
            }
          }

          console.log(`[execution-callback] Decomp review processed: verdict=${verdict}`);
        }
      } catch (decompReviewErr) {
        console.error(`[execution-callback] Decomp review handling error: ${decompReviewErr.message}`);
      }

      // 5c2. 秋米拆解完成 → 触发 Vivian 审查 + KR 状态更新
      try {
        const decompCheckResult = await pool.query('SELECT task_type, payload, goal_id FROM tasks WHERE id = $1', [task_id]);
        const decompCheckRow = decompCheckResult.rows[0];

        // 只处理秋米的拆解任务（不是 Vivian 的 decomp_review）
        if (decompCheckRow?.payload?.decomposition === 'true'
            && decompCheckRow?.task_type !== 'decomp_review'
            && decompCheckRow?.goal_id) {
          const krId = decompCheckRow.goal_id;

          // 检查 KR 是否处于 decomposing 状态
          const krCheckResult = await pool.query(
            'SELECT id, title, status FROM goals WHERE id = $1 AND status = $2',
            [krId, 'decomposing']
          );

          if (krCheckResult.rows.length > 0) {
            // 找到秋米创建的 Project（通过 project_kr_links）
            const projectCheckResult = await pool.query(`
              SELECT p.id, p.name FROM projects p
              INNER JOIN project_kr_links pkl ON pkl.project_id = p.id
              WHERE pkl.kr_id = $1 AND p.type = 'project'
              ORDER BY p.created_at DESC LIMIT 1
            `, [krId]);

            if (projectCheckResult.rows.length > 0) {
              const project = projectCheckResult.rows[0];

              // 触发 Vivian 审查
              const { shouldTriggerReview, createReviewTask } = await import('./review-gate.js');
              const needsReview = await shouldTriggerReview(pool, 'project', project.id);

              if (needsReview) {
                await createReviewTask(pool, {
                  entityType: 'project',
                  entityId: project.id,
                  entityName: project.name,
                  parentKrId: krId,
                });
                console.log(`[execution-callback] Vivian review triggered for KR ${krId} project ${project.id}`);
              }

              // 创建用户确认门：okr_decomp_review pending_action
              try {
                const krTitle = krCheckResult.rows[0].title;
                const projectName = project.name;

                // 查询拆解产出的 Initiatives
                const initiativesResult = await pool.query(`
                  SELECT p2.name FROM projects p2
                  WHERE p2.parent_id = $1 AND p2.type = 'initiative'
                  ORDER BY p2.created_at ASC
                `, [project.id]);
                const initiatives = initiativesResult.rows.map(r => r.name);

                // 签名去重：同一 KR 24h 内不重复创建
                const existingApproval = await pool.query(`
                  SELECT id FROM pending_actions
                  WHERE action_type = 'okr_decomp_review'
                    AND status = 'pending_approval'
                    AND (params->>'kr_id') = $1
                    AND created_at > NOW() - INTERVAL '24 hours'
                  LIMIT 1
                `, [krId]);

                if (existingApproval.rows.length === 0) {
                  await pool.query(`
                    INSERT INTO pending_actions
                      (action_type, category, params, context, priority, source, expires_at, status)
                    VALUES
                      ('okr_decomp_review', 'approval', $1, $2, 'urgent', 'okr_decomposer',
                       NOW() + INTERVAL '72 hours', 'pending_approval')
                  `, [
                    JSON.stringify({ kr_id: krId, project_id: project.id }),
                    JSON.stringify({
                      kr_title: krTitle,
                      project_name: projectName,
                      initiatives,
                      decomposed_at: new Date().toISOString()
                    })
                  ]);
                  console.log(`[execution-callback] OKR 确认门已创建：KR ${krId}「${krTitle}」，${initiatives.length} 个 Initiative`);
                } else {
                  console.log(`[execution-callback] OKR 确认门已存在（去重跳过）：KR ${krId}`);
                }
              } catch (approvalErr) {
                console.error(`[execution-callback] 创建 OKR 确认门失败（非阻塞）: ${approvalErr.message}`);
              }
            }

            // 更新 KR 状态: decomposing → reviewing
            await pool.query(
              `UPDATE goals SET status = 'reviewing', updated_at = NOW() WHERE id = $1`,
              [krId]
            );
            console.log(`[execution-callback] KR ${krId} → reviewing (秋米拆解完成)`);
          }
        }
      } catch (decompTriggerErr) {
        console.error(`[execution-callback] Decomp → review trigger error: ${decompTriggerErr.message}`);
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

    // 5c5. Suggestion Plan 闭环：suggestion_plan 完成/失败 → 更新 suggestion.status
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        const spResult = await pool.query('SELECT task_type, payload FROM tasks WHERE id = $1', [task_id]);
        const spRow = spResult.rows[0];

        if (spRow?.task_type === 'suggestion_plan') {
          const suggestionId = spRow?.payload?.suggestion_id;
          if (suggestionId) {
            const suggestionStatus = newStatus === 'completed' ? 'processed' : 'failed';
            await pool.query(
              `UPDATE suggestions SET status = $1, updated_at = NOW() WHERE id = $2`,
              [suggestionStatus, suggestionId]
            );
            console.log(`[execution-callback] Suggestion ${suggestionId} → ${suggestionStatus} (suggestion_plan task ${task_id})`);
          }
        }
      } catch (spErr) {
        // best-effort：失败不影响主流程
        console.error(`[execution-callback] Suggestion status update error (non-fatal): ${spErr.message}`);
      }
    }

    // 5d. Auto-Learning: 自动从任务执行结果中学习
    if (newStatus === 'completed' || newStatus === 'failed') {
      try {
        const { processExecutionAutoLearning } = await import('./auto-learning.js');
        const learningResult = await processExecutionAutoLearning(task_id, newStatus, result, {
          trigger_source: 'execution_callback',
          retry_count: iterations,
          iterations: iterations,
          metadata: {
            run_id,
            duration_ms,
            pr_url: pr_url || null
          }
        });

        if (learningResult) {
          console.log(`[execution-callback] Auto-learning created: ${learningResult.title} (id: ${learningResult.id})`);
        }
      } catch (autoLearningErr) {
        console.error(`[execution-callback] Auto-learning error (non-fatal): ${autoLearningErr.message}`);
        // Continue with normal flow - auto-learning failure should not affect main functionality
      }
    }

    // 5e. Initiative 执行循环：dev 任务完成 → 触发下一轮 initiative_plan
    // completed_no_pr（无 PR 的完成）同样需要触发，避免循环中断
    if (newStatus === 'completed' || newStatus === 'completed_no_pr') {
      try {
        const devTaskRow = await pool.query(
          'SELECT task_type, project_id, payload FROM tasks WHERE id = $1',
          [task_id]
        );
        const devTask = devTaskRow.rows[0];

        // 仅处理 dev 类型任务（非拆解任务）
        const isDevTask = devTask?.task_type === 'dev' && !devTask?.payload?.decomposition;

        if (isDevTask && devTask?.project_id) {
          // 检查 project 是否为 initiative 且仍然活跃
          const projectRow = await pool.query(
            "SELECT id, name, type, status FROM projects WHERE id = $1 AND type = 'initiative' AND status IN ('active', 'in_progress')",
            [devTask.project_id]
          );
          const initiative = projectRow.rows[0];

          if (initiative) {
            // 幂等检查：已有 queued/in_progress 的 initiative_plan 任务则跳过
            const existingPlan = await pool.query(
              "SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'initiative_plan' AND status IN ('queued', 'in_progress') LIMIT 1",
              [initiative.id]
            );

            if (existingPlan.rows.length === 0) {
              // 获取所属 KR（通过 parent project 的 project_kr_links）
              const krRow = await pool.query(`
                SELECT pkl.kr_id
                FROM projects p
                LEFT JOIN project_kr_links pkl ON pkl.project_id = p.parent_id
                WHERE p.id = $1
                LIMIT 1
              `, [initiative.id]);
              const krId = krRow.rows[0]?.kr_id || null;

              const planTitle = `Initiative 规划: ${initiative.name}`;
              const planDescription = [
                `请为 Initiative「${initiative.name}」规划下一个 PR。`,
                '',
                '你的任务（initiative_plan 模式）：',
                '1. 读取 Initiative 描述（GET /api/brain/projects/' + initiative.id + '）',
                '2. 读取已完成的 PR 列表（GET /api/brain/tasks?project_id=' + initiative.id + '&status=completed）',
                '3. 判断 Initiative 目标是否达成',
                '   - 已达成 → 标记 Initiative completed，结束',
                '   - 未达成 → 规划下一个 PR，写入 tasks 表一条 dev 任务',
                '',
                `Initiative ID: ${initiative.id}`,
                `Initiative 名称: ${initiative.name}`,
                `所属 KR ID: ${krId || '(未知)'}`,
                `触发原因: dev 任务 ${task_id} 已完成，继续执行循环`,
              ].join('\n');

              await pool.query(`
                INSERT INTO tasks (title, description, status, priority, goal_id, project_id, task_type, trigger_source)
                VALUES ($1, $2, 'queued', 'P1', $3, $4, 'initiative_plan', 'execution_callback')
              `, [planTitle, planDescription, krId, initiative.id]);

              console.log(`[execution-callback] Initiative ${initiative.id} 执行循环：创建下一轮 initiative_plan 任务`);
            } else {
              console.log(`[execution-callback] Initiative ${initiative.id} 已有 initiative_plan 任务，跳过创建`);
            }
          }
        }
      } catch (initiativeLoopErr) {
        console.error(`[execution-callback] Initiative 执行循环错误（非阻塞）: ${initiativeLoopErr.message}`);
      }
    }

    // 6. Event-driven: Trigger next task after completion (with short cooldown to avoid burst refill)
    let nextTickResult = null;
    if (newStatus === 'completed') {
      const CALLBACK_COOLDOWN_MS = 5000; // 5s cooldown prevents instant slot refill on rapid completions
      console.log(`[execution-callback] Task completed, triggering next tick in ${CALLBACK_COOLDOWN_MS}ms...`);
      try {
        await new Promise(resolve => setTimeout(resolve, CALLBACK_COOLDOWN_MS));
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

// ==================== Heartbeat File API ====================

const HEARTBEAT_PATH = new URL('../../HEARTBEAT.md', import.meta.url);

const HEARTBEAT_DEFAULT_TEMPLATE = `# HEARTBEAT.md — Cecelia 巡检清单

## 巡检项目

- [ ] 系统健康检查
- [ ] 任务队列状态
- [ ] 资源使用率
`;

/**
 * GET /api/brain/heartbeat
 * Read HEARTBEAT.md file content.
 * Returns default template if file does not exist.
 */
router.get('/heartbeat', async (req, res) => {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(HEARTBEAT_PATH, 'utf-8');
    res.json({ success: true, content });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ success: true, content: HEARTBEAT_DEFAULT_TEMPLATE });
    }
    console.error('[heartbeat-file] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/brain/heartbeat
 * Write content to HEARTBEAT.md file.
 * Request body: { content: "..." }
 */
router.put('/heartbeat', async (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    const { writeFile } = await import('fs/promises');
    await writeFile(HEARTBEAT_PATH, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('[heartbeat-file] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
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

// ==================== VPS Slots API ====================

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

/**
 * GET /api/brain/slots
 * Three-pool slot allocation status
 */
router.get('/slots', async (req, res) => {
  try {
    const { getSlotStatus } = await import('./slot-allocator.js');
    const status = await getSlotStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/brain/budget-cap
 * Set or clear the budget cap (dual-layer capacity model)
 */
router.put('/budget-cap', async (req, res) => {
  try {
    const { setBudgetCap } = await import('./executor.js');
    const result = setBudgetCap(req.body.slots ?? null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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

// ==================== Work Streams API ====================

/**
 * GET /api/brain/work/streams
 * 返回当前 Area Stream 调度状态，供前端展示
 * 使用 planner.js 的 selectTopAreas + selectActiveInitiativeForArea
 */
router.get('/work/streams', async (_req, res) => {
  try {
    const state = await getGlobalState();
    const topAreas = selectTopAreas(state, ACTIVE_AREA_COUNT);

    const streams = topAreas.map(area => {
      const areaKRs = state.keyResults.filter(kr => kr.parent_id === area.id);
      const areaKRIds = new Set(areaKRs.map(kr => kr.id));

      const areaTasks = state.activeTasks.filter(
        t => (t.status === 'queued' || t.status === 'in_progress') && areaKRIds.has(t.goal_id)
      );
      const totalQueuedTasks = areaTasks.filter(t => t.status === 'queued').length;

      const initiativeResult = selectActiveInitiativeForArea(area, state);
      let activeInitiative = null;
      if (initiativeResult) {
        const { initiative, kr } = initiativeResult;
        const initTasks = areaTasks.filter(t => t.project_id === initiative.id);
        const inProgressCount = initTasks.filter(t => t.status === 'in_progress').length;
        const queuedCount = initTasks.filter(t => t.status === 'queued').length;
        // lockReason: in_progress 任务存在 → 'in_progress'，否则 → 'fifo'
        const lockReason = inProgressCount > 0 ? 'in_progress' : 'fifo';
        activeInitiative = {
          initiative: {
            id: initiative.id,
            name: initiative.name,
            status: initiative.status,
            created_at: initiative.created_at,
          },
          kr: { id: kr.id, title: kr.title || kr.name },
          lockReason,
          inProgressTasks: inProgressCount,
          queuedTasks: queuedCount,
        };
      }

      return {
        area: {
          id: area.id,
          title: area.title || area.name,
          priority: area.priority,
          status: area.status,
          progress: area.progress || 0,
        },
        activeInitiative,
        totalQueuedTasks,
      };
    });

    res.json({
      activeAreaCount: ACTIVE_AREA_COUNT,
      streams,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[work/streams] Error:', err);
    res.status(500).json({ error: 'Failed to get work streams', details: err.message });
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

// ==================== Task Router API ====================

/**
 * POST /api/brain/identify-work-type
 * Identify if input is a single task or initiative
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
    const { title, task_type, initiative_id, feature_id, is_recurring } = req.body;

    if (!title && !task_type) {
      return res.status(400).json({ success: false, error: 'title or task_type is required' });
    }

    const routing = routeTaskCreate({ title, task_type, feature_id: initiative_id || feature_id, is_recurring });
    res.json({ success: true, ...routing });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to route task create', details: err.message });
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

// ============================================================
// Cortex Analyses API — Historical RCA Memory
// ============================================================

import { searchRelevantAnalyses } from './cortex.js';
import {
  evaluateQualityInitial,
  checkShouldCreateRCA,
  getQualityStats,
} from './cortex-quality.js';

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

    const { recordQualityFeedback, updateEffectivenessScore } = await import('./cortex-quality.js');

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

    const { evaluateStrategyEffectiveness } = await import('./learning.js');
    const result = await evaluateStrategyEffectiveness(strategy_key, days);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Failed to evaluate strategy:', err.message);
    res.status(500).json({ error: err.message });
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
    const { current_stage, owner } = req.query;

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
    const { getMonitorStatus } = await import('./monitor-loop.js');
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

    const { default: SimilarityService } = await import('./similarity.js');
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

// ============================================================
// Immune System API
// ============================================================

/**
 * GET /api/brain/policies
 * List absorption policies with optional filtering
 */
router.get('/policies', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT
        policy_id,
        signature,
        status,
        policy_json,
        risk_level,
        success_count,
        failure_count,
        created_at,
        promoted_at
      FROM absorption_policies
    `;

    const params = [];
    const whereClauses = [];

    if (status) {
      whereClauses.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM absorption_policies`;
    if (whereClauses.length > 0) {
      countQuery += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    const countResult = await pool.query(countQuery, status ? [status] : []);

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].total)
    });
  } catch (err) {
    console.error('[API] Failed to list policies:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to list policies',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/policies/promotions
 * Get promotion history (probation → active)
 * NOTE: Must be before /policies/:id to avoid matching "promotions" as an ID
 */
router.get('/policies/promotions', async (req, res) => {
  try {
    const { limit = 20, days = 7 } = req.query;

    const result = await pool.query(`
      SELECT
        pe.policy_id,
        ap.signature,
        pe.evaluated_at as promoted_at,
        ap.risk_level,
        COUNT(DISTINCT CASE WHEN pe.mode = 'simulate' THEN pe.eval_id END) as simulations,
        ROUND(
          COUNT(DISTINCT CASE WHEN pe.mode = 'simulate' AND pe.result = 'would_succeed' THEN pe.eval_id END)::numeric /
          NULLIF(COUNT(DISTINCT CASE WHEN pe.mode = 'simulate' THEN pe.eval_id END), 0),
          2
        ) as pass_rate
      FROM policy_evaluations pe
      JOIN absorption_policies ap ON pe.policy_id = ap.policy_id
      WHERE
        pe.mode = 'promote'
        AND pe.evaluated_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY pe.policy_id, ap.signature, pe.evaluated_at, ap.risk_level
      ORDER BY pe.evaluated_at DESC
      LIMIT $1
    `, [parseInt(limit)]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('[API] Failed to get promotions:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get promotions',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/policies/:id
 * Get single policy with recent evaluations
 */
router.get('/policies/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get policy
    const policyResult = await pool.query(`
      SELECT
        policy_id,
        signature,
        status,
        policy_json,
        risk_level,
        success_count,
        failure_count,
        created_at,
        promoted_at
      FROM absorption_policies
      WHERE policy_id = $1
    `, [id]);

    if (policyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Policy not found'
      });
    }

    const policy = policyResult.rows[0];

    // Get recent 10 evaluations
    const evalsResult = await pool.query(`
      SELECT
        eval_id,
        task_id,
        mode,
        result,
        evaluated_at,
        details
      FROM policy_evaluations
      WHERE policy_id = $1
      ORDER BY evaluated_at DESC
      LIMIT 10
    `, [id]);

    policy.evaluations = evalsResult.rows;

    res.json({
      success: true,
      data: policy
    });
  } catch (err) {
    console.error('[API] Failed to get policy:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get policy',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/policies/:id/evaluations
 * Get policy evaluation history with pagination
 */
router.get('/policies/:id/evaluations', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    // Check if policy exists
    const policyCheck = await pool.query(`
      SELECT policy_id FROM absorption_policies WHERE policy_id = $1
    `, [id]);

    if (policyCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Policy not found'
      });
    }

    // Get evaluations
    const result = await pool.query(`
      SELECT
        eval_id,
        task_id,
        mode,
        result,
        evaluated_at,
        details
      FROM policy_evaluations
      WHERE policy_id = $1
      ORDER BY evaluated_at DESC
      LIMIT $2 OFFSET $3
    `, [id, parseInt(limit), parseInt(offset)]);

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM policy_evaluations WHERE policy_id = $1
    `, [id]);

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].total)
    });
  } catch (err) {
    console.error('[API] Failed to get policy evaluations:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get policy evaluations',
      details: err.message
    });
  }
});

/**
 * PATCH /api/brain/policies/:id/status
 * Update policy status (manual control)
 */
router.patch('/policies/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: status'
      });
    }

    const validStatuses = ['draft', 'probation', 'active', 'disabled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Update status
    const result = await pool.query(`
      UPDATE absorption_policies
      SET status = $1, updated_at = NOW()
      WHERE policy_id = $2
      RETURNING policy_id
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Policy not found'
      });
    }

    // Log event
    await pool.query(`
      INSERT INTO cecelia_events (event_type, payload)
      VALUES ('policy_status_updated', $1)
    `, [JSON.stringify({ policy_id: id, status, reason, updated_by: 'api' })]);

    res.json({
      success: true,
      message: `Policy status updated to ${status}`
    });
  } catch (err) {
    console.error('[API] Failed to update policy status:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update policy status',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/failures/signatures
 * Get failure signatures statistics
 */
router.get('/failures/signatures', async (req, res) => {
  try {
    const { limit = 20, min_count = 1 } = req.query;

    const result = await pool.query(`
      SELECT
        fs.signature,
        fs.count,
        fs.first_seen,
        fs.last_seen,
        COUNT(DISTINCT CASE WHEN ap.status = 'active' THEN ap.policy_id END) as active_policies,
        COUNT(DISTINCT CASE WHEN ap.status = 'probation' THEN ap.policy_id END) as probation_policies
      FROM failure_signatures fs
      LEFT JOIN absorption_policies ap ON fs.signature = ap.signature
      WHERE fs.count >= $1
      GROUP BY fs.signature, fs.count, fs.first_seen, fs.last_seen
      ORDER BY fs.count DESC
      LIMIT $2
    `, [parseInt(min_count), parseInt(limit)]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('[API] Failed to get failure signatures:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get failure signatures',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/failures/signatures/:signature
 * Get single failure signature with related policies
 */
router.get('/failures/signatures/:signature', async (req, res) => {
  try {
    const { signature } = req.params;

    // Get signature info
    const sigResult = await pool.query(`
      SELECT signature, count, first_seen, last_seen
      FROM failure_signatures
      WHERE signature = $1
    `, [signature]);

    if (sigResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Signature not found'
      });
    }

    const signatureData = sigResult.rows[0];

    // Get related policies
    const policiesResult = await pool.query(`
      SELECT
        policy_id,
        status,
        policy_json,
        risk_level,
        success_count,
        failure_count,
        created_at,
        promoted_at
      FROM absorption_policies
      WHERE signature = $1
      ORDER BY
        CASE status
          WHEN 'active' THEN 1
          WHEN 'probation' THEN 2
          WHEN 'draft' THEN 3
          WHEN 'disabled' THEN 4
        END,
        created_at DESC
    `, [signature]);

    signatureData.policies = policiesResult.rows;

    res.json({
      success: true,
      data: signatureData
    });
  } catch (err) {
    console.error('[API] Failed to get signature details:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get signature details',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/immune/dashboard
 * Immune system overview with aggregated data
 */
router.get('/immune/dashboard', async (req, res) => {
  try {
    // Policy statistics
    const policyStats = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM absorption_policies
      GROUP BY status
    `);

    const policies = {
      draft: 0,
      probation: 0,
      active: 0,
      disabled: 0,
      total: 0
    };

    policyStats.rows.forEach(row => {
      policies[row.status] = parseInt(row.count);
      policies.total += parseInt(row.count);
    });

    // Quarantine statistics (reuse existing data)
    const quarantineStats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN quarantine_reason = 'failure_threshold' THEN 1 END) as failure_threshold,
        COUNT(CASE WHEN quarantine_reason = 'manual' THEN 1 END) as manual,
        COUNT(CASE WHEN quarantine_reason = 'resource_hog' THEN 1 END) as resource_hog
      FROM tasks
      WHERE status = 'quarantined'
    `);

    const quarantine = {
      total: parseInt(quarantineStats.rows[0].total),
      by_reason: {
        failure_threshold: parseInt(quarantineStats.rows[0].failure_threshold),
        manual: parseInt(quarantineStats.rows[0].manual),
        resource_hog: parseInt(quarantineStats.rows[0].resource_hog)
      }
    };

    // Top failure signatures
    const topSignatures = await pool.query(`
      SELECT signature, count
      FROM failure_signatures
      ORDER BY count DESC
      LIMIT 10
    `);

    // Recent promotions
    const recentPromotions = await pool.query(`
      SELECT
        pe.policy_id,
        ap.signature,
        pe.evaluated_at as promoted_at
      FROM policy_evaluations pe
      JOIN absorption_policies ap ON pe.policy_id = ap.policy_id
      WHERE pe.mode = 'promote'
      ORDER BY pe.evaluated_at DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      data: {
        policies,
        quarantine,
        failures: {
          top_signatures: topSignatures.rows
        },
        recent_promotions: recentPromotions.rows
      }
    });
  } catch (err) {
    console.error('[API] Failed to get immune dashboard:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get immune dashboard',
      details: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brain/routing/decisions - Thalamus routing decision history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/routing/decisions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const routeType = req.query.route_type || null;
    const eventType = req.query.event_type || null;
    const since = req.query.since || null;
    const hours = parseInt(req.query.hours) || 24;

    const conditions = ["event_type = 'routing_decision'"];
    const values = [];
    let idx = 1;

    if (since) {
      conditions.push(`created_at >= $${idx++}`);
      values.push(since);
    } else {
      conditions.push(`created_at >= NOW() - INTERVAL '${hours} hours'`);
    }

    if (routeType) {
      conditions.push(`payload->>'route_type' = $${idx++}`);
      values.push(routeType);
    }

    if (eventType) {
      conditions.push(`payload->>'event_type' = $${idx++}`);
      values.push(eventType);
    }

    const whereClause = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      pool.query(`
        SELECT
          id,
          payload->>'route_type' AS route_type,
          payload->>'event_type' AS event_type,
          (payload->>'confidence')::float AS confidence,
          (payload->>'level')::int AS level,
          payload->'actions' AS actions,
          payload->>'rationale' AS rationale,
          (payload->>'latency_ms')::int AS latency_ms,
          created_at AS timestamp
        FROM cecelia_events
        WHERE ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, limit, offset]),
      pool.query(`
        SELECT COUNT(*) AS total
        FROM cecelia_events
        WHERE ${whereClause}
      `, values)
    ]);

    res.json({
      success: true,
      decisions: dataResult.rows,
      count: dataResult.rows.length,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
  } catch (err) {
    console.error('[API] Failed to get routing decisions:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get routing decisions', details: err.message });
  }
});

// POST /api/brain/manual-mode — 启用/禁用手动模式（暂停自动任务创建）
router.post('/manual-mode', async (req, res) => {
  try {
    const { enabled } = req.body;
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ('manual_mode', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
    `, [{ enabled: !!enabled }]);
    console.log(`[brain] Manual mode ${enabled ? 'enabled' : 'disabled'}`);
    res.json({ success: true, manual_mode: !!enabled });
  } catch (err) {
    console.error('[API] Failed to set manual mode:', err.message);
    res.status(500).json({ success: false, error: 'Failed to set manual mode', details: err.message });
  }
});

// GET /api/brain/manual-mode — 查询手动模式状态
router.get('/manual-mode', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT value_json FROM working_memory WHERE key = 'manual_mode'"
    );
    const enabled = result.rows.length > 0 && result.rows[0].value_json?.enabled === true;
    res.json({ success: true, manual_mode: enabled });
  } catch (err) {
    console.error('[API] Failed to get manual mode:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get manual mode', details: err.message });
  }
});

/**
 * triggerAutoRCA — 任务失败时自动触发 RCA（依赖注入，便于测试）
 * @param {object} opts
 * @param {string} opts.task_id
 * @param {string} opts.errorMsg
 * @param {object} opts.classification - { class, pattern }
 * @param {function} opts.shouldAnalyzeFailure - async (task_id, errorMsg) => { should_analyze, signature, cached_result? }
 * @param {function} opts.performRCA - async ({ task_id, error, classification }) => {}
 */
export async function triggerAutoRCA({ task_id, errorMsg, classification, shouldAnalyzeFailure, performRCA }) {
  // BILLING_CAP 类型不需要 RCA
  if (classification?.class === 'BILLING_CAP') {
    console.log(`[AutoRCA] Skip task=${task_id}: BILLING_CAP`);
    return;
  }

  try {
    // 去重检查
    const dedup = await shouldAnalyzeFailure(task_id, errorMsg);
    if (!dedup.should_analyze) {
      console.log(`[AutoRCA] Skip task=${task_id}: duplicate (signature=${dedup.signature})`);
      return;
    }

    // 执行 RCA
    console.log(`[AutoRCA] Analyzing task=${task_id}`);
    await performRCA({ task_id, error: errorMsg, classification });
  } catch (err) {
    console.error(`[AutoRCA] Error analyzing task=${task_id}: ${err.message}`);
  }
}

// ==================== Orchestrator Chat ====================

/**
 * POST /api/brain/orchestrator/chat
 * Cecelia 嘴巴对话端点
 *
 * Request: { message: string, context?: { conversation_id, history }, messages?: Array<{role, content}> }
 * Response: { reply: string, routing_level: number, intent: string }
 */
router.post('/orchestrator/chat', async (req, res) => {
  try {
    const { message, context, messages } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'message is required and must be a string',
      });
    }

    const result = await handleChat(message, context || {}, Array.isArray(messages) ? messages : []);
    res.json(result);
  } catch (err) {
    console.error('[API] orchestrator/chat error:', err.message);
    res.status(500).json({
      error: 'Chat failed',
      message: err.message,
    });
  }
});

/**
 * GET /api/brain/orchestrator/chat/history
 * 返回最近 N 条对话历史（从 cecelia_events 重建消息对）
 *
 * Query: ?limit=20 (默认 20，最大 100)
 * Response: Array<{ role: 'user'|'assistant', content: string, created_at: string }>
 */
router.get('/orchestrator/chat/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const result = await pool.query(
      `SELECT payload, created_at FROM cecelia_events
       WHERE event_type = 'orchestrator_chat'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    // 从新到旧倒序排列，重建为时间正序的消息对数组
    const messages = result.rows.reverse().flatMap(row => {
      const p = row.payload;
      const createdAt = row.created_at;
      return [
        { role: 'user', content: p.user_message || '', created_at: createdAt },
        { role: 'assistant', content: p.reply || p.reply_preview || '', created_at: createdAt },
      ];
    });

    res.json(messages);
  } catch (err) {
    console.error('[API] orchestrator/chat/history error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch chat history',
      message: err.message,
    });
  }
});

// ==================== User Profile ====================

/**
 * GET /api/brain/user/profile
 * 查询当前用户画像
 */
router.get('/user/profile', async (_req, res) => {
  try {
    const profile = await loadUserProfile(pool, 'owner');
    res.json({ profile: profile || null });
  } catch (err) {
    console.error('[API] user/profile GET error:', err.message);
    res.status(500).json({ error: 'Failed to load user profile', message: err.message });
  }
});

/**
 * PUT /api/brain/user/profile
 * 手动更新用户画像
 * Body: { display_name?, focus_area?, preferred_style?, timezone?, raw_facts? }
 */
router.put('/user/profile', async (req, res) => {
  try {
    const { display_name, focus_area, preferred_style, timezone, raw_facts } = req.body || {};
    const facts = { display_name, focus_area, preferred_style, timezone, raw_facts };
    const updated = await upsertUserProfile(pool, 'owner', facts);
    res.json({ profile: updated });
  } catch (err) {
    console.error('[API] user/profile PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update user profile', message: err.message });
  }
});

// ==================== Orchestrator Realtime ====================

/**
 * GET /api/brain/orchestrator/realtime/config
 * 返回 OpenAI Realtime API 配置（api_key, model, voice, tools）
 */
router.get('/orchestrator/realtime/config', (_req, res) => {
  const result = getRealtimeConfig();
  if (!result.success) {
    return res.status(500).json(result);
  }
  res.json(result);
});

/**
 * POST /api/brain/orchestrator/realtime/tool
 * 处理 Realtime 语音会话中的工具调用
 *
 * Request: { tool_name: string, arguments?: object }
 * Response: { success: boolean, result?: object, error?: string }
 */
router.post('/orchestrator/realtime/tool', async (req, res) => {
  try {
    const { tool_name, arguments: args } = req.body;

    if (!tool_name || typeof tool_name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'tool_name is required and must be a string',
      });
    }

    const result = await handleRealtimeTool(tool_name, args || {});
    res.json(result);
  } catch (err) {
    console.error('[API] orchestrator/realtime/tool error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== Staff API ====================

/**
 * GET /api/brain/staff
 * 返回所有员工列表，含角色和模型配置
 */
router.get('/staff', async (_req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // 1. 读 workers.config.json
    const workersPath = '/home/xx/perfect21/cecelia/workflows/staff/workers.config.json';
    const workersRaw = fs.readFileSync(workersPath, 'utf-8');
    const workersConfig = JSON.parse(workersRaw);

    // 2. 读 model_map（当前 active profile）
    const activeProfile = getActiveProfile();
    const modelMap = activeProfile?.config?.executor?.model_map || {};

    // 3. 合并数据
    const teams = workersConfig.teams.map(team => ({
      id: team.id,
      name: team.name,
      area: team.area || null,
      department: team.department || null,
      level: team.level,
      icon: team.icon,
      description: team.description,
      workers: team.workers.map(worker => {
        // 从 model_map 找对应模型（按 worker.id 或 worker.skill）
        const skillKey = worker.skill?.replace('/', '') || worker.id;
        const modelEntry = modelMap[skillKey] || modelMap[worker.id] || {};
        // 取第一个非 null 的 provider/model
        let activeModel = null;
        let activeProvider = null;
        for (const [provider, model] of Object.entries(modelEntry)) {
          if (model) {
            activeProvider = provider;
            activeModel = model;
            break;
          }
        }
        const credentialsFile = modelEntry.credentials || modelEntry.minimax_credentials || worker.credentials_file || null;
        return {
          id: worker.id,
          name: worker.name,
          alias: worker.alias || null,
          icon: worker.icon,
          type: worker.type,
          role: worker.role,
          skill: worker.skill || null,
          description: worker.description,
          abilities: worker.abilities || [],
          gradient: worker.gradient || null,
          model: {
            provider: activeProvider,
            name: activeModel,
            full_map: modelEntry,
            credentials_file: credentialsFile,
          },
        };
      }),
    }));

    res.json({
      success: true,
      version: workersConfig.version,
      areas: workersConfig.areas || {},
      teams,
      total_workers: teams.reduce((sum, t) => sum + t.workers.length, 0),
    });
  } catch (err) {
    console.error('[API] staff error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== Staff Worker Edit API ====================

/**
 * PUT /api/brain/staff/workers/:workerId
 * 更新 worker 的 skill 和/或 model 配置
 * body: { skill?: string, model?: { provider: string, name: string } }
 */
router.put('/staff/workers/:workerId', async (req, res) => {
  try {
    const { workerId } = req.params;
    const { skill, model, credentials_file } = req.body;
    const fs = await import('fs');

    const workersPath = '/home/xx/perfect21/cecelia/workflows/staff/workers.config.json';
    const workersConfig = JSON.parse(fs.readFileSync(workersPath, 'utf-8'));

    // 找到 worker
    let targetWorker = null;
    for (const team of workersConfig.teams) {
      const worker = team.workers.find(w => w.id === workerId);
      if (worker) {
        if (skill !== undefined) {
          worker.skill = skill || null;
        }
        if (credentials_file !== undefined) {
          worker.credentials_file = credentials_file || null;
        }
        targetWorker = worker;
        break;
      }
    }
    if (!targetWorker) {
      return res.status(404).json({ success: false, error: `Worker ${workerId} not found` });
    }

    // 保存 workers.config.json（skill 变更）
    fs.writeFileSync(workersPath, JSON.stringify(workersConfig, null, 2));

    // 更新 model（直接写 active profile 的 model_map）
    if (model?.provider && model?.name) {
      const { rows: activeRows } = await pool.query(
        'SELECT id, config FROM model_profiles WHERE is_active = true LIMIT 1'
      );
      if (activeRows.length > 0) {
        const profile = activeRows[0];
        const config = { ...profile.config };
        const modelMap = { ...(config.executor?.model_map || {}) };
        const skillKey = targetWorker.skill?.replace('/', '') || workerId;
        const existing = modelMap[skillKey] || {};
        const newMap = {
          anthropic: model.provider === 'anthropic' ? model.name : (existing.anthropic || null),
          minimax:   model.provider === 'minimax'   ? model.name : (existing.minimax   || null),
          openai:    model.provider === 'openai'    ? model.name : (existing.openai    || null),
        };
        // 保存 credentials（通用账户选择，适用所有 provider）
        if (credentials_file !== undefined) {
          newMap.credentials = credentials_file || null;
          newMap.minimax_credentials = credentials_file || null; // 向后兼容
        } else if (existing.credentials !== undefined) {
          newMap.credentials = existing.credentials;
          newMap.minimax_credentials = existing.minimax_credentials;
        }
        modelMap[skillKey] = newMap;
        config.executor = { ...config.executor, model_map: modelMap };
        await pool.query(
          'UPDATE model_profiles SET config = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(config), profile.id]
        );
        const { loadActiveProfile } = await import('./model-profile.js');
        await loadActiveProfile(pool);
      }
    }

    res.json({ success: true, workerId });
  } catch (err) {
    console.error('[API] staff worker PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== Account Usage API ====================

/**
 * GET /api/brain/account-usage
 * 返回所有 Claude Max 账号当前用量（读缓存，10分钟 TTL）
 */
router.get('/account-usage', async (_req, res) => {
  try {
    const usage = await getAccountUsage();
    res.json({ ok: true, usage });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/brain/account-usage/refresh
 * 强制刷新账号用量缓存（忽略 TTL，直接从 Anthropic API 获取）
 */
router.post('/account-usage/refresh', async (_req, res) => {
  try {
    const usage = await getAccountUsage(true); // forceRefresh=true
    const best = await selectBestAccount();
    res.json({ ok: true, usage, recommended: best || 'minimax (all at capacity)' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== Credentials API ====================

/**
 * GET /api/brain/credentials
 * 返回可用账户列表（扫描 account*.json 和 ~/.credentials/*.json）
 */
router.get('/credentials', async (_req, res) => {
  const credentials = [];

  // 1. Anthropic OAuth accounts: ~/.claude/.account*.json
  const claudeDir = '/home/xx/.claude';
  try {
    const files = readdirSync(claudeDir);
    files.filter(f => /^\.account\d+\.json$/.test(f)).sort().forEach(file => {
      const num = file.match(/\.account(\d+)\.json/)[1];
      credentials.push({
        name: `account${num}`,
        type: 'anthropic_oauth',
        provider: 'anthropic'
      });
    });
  } catch(e) { /* dir may not exist in test env */ }

  // 2. API key credentials: /home/cecelia/.credentials/*.json (Docker mount)
  const credDir = '/home/cecelia/.credentials';
  try {
    const files = readdirSync(credDir);
    files.filter(f => f.endsWith('.json')).sort().forEach(file => {
      const name = file.replace('.json', '');
      let provider = 'openai';
      if (name.startsWith('minimax')) provider = 'minimax';
      else if (name.startsWith('openai')) provider = 'openai';
      credentials.push({
        name,
        type: 'api_key',
        provider
      });
    });
  } catch(e) { /* dir may not exist in test env */ }

  res.json({ credentials });
});

// ==================== Skills Registry API ====================

/**
 * GET /api/brain/skills-registry
 * 返回所有注册的 Skills 和 Agents（从 cecelia-workflows 读取）
 */
router.get('/skills-registry', async (_req, res) => {
  try {
    const fs = await import('fs');
    const path = await import('path');

    const WORKFLOWS_BASE = '/home/xx/perfect21/cecelia/workflows';

    function parseSkillMd(filePath) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // 解析 YAML frontmatter（--- ... ---）
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const frontmatter = {};
        for (const line of match[1].split('\n')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) continue;
          const key = line.slice(0, colonIdx).trim();
          let value = line.slice(colonIdx + 1).trim();
          // 去掉引号
          value = value.replace(/^["']|["']$/g, '');
          if (key && value) frontmatter[key] = value;
        }
        // description 可能是多行，取 | 之后的第一行
        const descMatch = content.match(/^description:\s*\|\n\s+(.*)/m);
        if (descMatch) frontmatter.description = descMatch[1].trim();

        return frontmatter;
      } catch {
        return null;
      }
    }

    function scanDir(baseDir, type) {
      const items = [];
      try {
        const dirs = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const dir of dirs) {
          if (!dir.isDirectory() && !dir.isSymbolicLink()) continue;
          const skillMdPath = path.join(baseDir, dir.name, 'SKILL.md');
          if (!fs.existsSync(skillMdPath)) continue;

          const meta = parseSkillMd(skillMdPath);
          items.push({
            id: dir.name,
            name: meta?.name || dir.name,
            description: meta?.description || '',
            version: meta?.version || '1.0.0',
            type,
            path: path.join(baseDir, dir.name),
          });
        }
      } catch {}
      return items;
    }

    const skills = scanDir(path.join(WORKFLOWS_BASE, 'skills'), 'skill');
    const agents = scanDir(path.join(WORKFLOWS_BASE, 'agents'), 'agent');

    res.json({
      success: true,
      total: skills.length + agents.length,
      skills,
      agents,
    });
  } catch (err) {
    console.error('[API] skills-registry error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== Model Profile API ====================

router.get('/model-profiles', async (_req, res) => {
  try {
    const profiles = await listModelProfiles(pool);
    res.json({ success: true, profiles });
  } catch (err) {
    console.error('[API] model-profiles list error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== Model Registry API ====================

router.get('/model-profiles/models', async (_req, res) => {
  try {
    const { MODELS, AGENTS } = await import('./model-registry.js');
    res.json({ success: true, models: MODELS, agents: AGENTS });
  } catch (err) {
    console.error('[API] model-registry error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/model-profiles/active', (_req, res) => {
  try {
    const profile = getActiveProfile();
    res.json({ success: true, profile });
  } catch (err) {
    console.error('[API] model-profiles active error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/model-profiles/active', async (req, res) => {
  try {
    const { profile_id } = req.body;
    if (!profile_id) {
      return res.status(400).json({ success: false, error: 'profile_id is required' });
    }
    const profile = await switchProfile(pool, profile_id);

    // WebSocket 广播 profile:changed
    websocketService.broadcast(websocketService.WS_EVENTS.PROFILE_CHANGED, {
      profile_id: profile.id,
      profile_name: profile.name,
    });

    res.json({ success: true, profile });
  } catch (err) {
    console.error('[API] model-profiles switch error:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.patch('/model-profiles/active/agent', async (req, res) => {
  try {
    const { agent_id, model_id } = req.body;
    if (!agent_id || !model_id) {
      return res.status(400).json({ success: false, error: 'agent_id and model_id are required' });
    }

    const result = await updateAgentModel(pool, agent_id, model_id);

    // WebSocket 广播
    websocketService.broadcast(websocketService.WS_EVENTS.PROFILE_CHANGED, {
      profile_id: result.profile.id,
      profile_name: result.profile.name,
      agent_id: result.agent_id,
      model_id: model_id,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] update-agent-model error:', err.message);
    const status = err.message.includes('Unknown agent') || err.message.includes('not allowed') || err.message.includes('locked to provider')
      ? 400 : err.message.includes('No active profile') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.patch('/model-profiles/active/agents', async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, error: 'updates array is required' });
    }

    const result = await batchUpdateAgentModels(pool, updates);

    websocketService.broadcast(websocketService.WS_EVENTS.PROFILE_CHANGED, {
      profile_id: result.profile.id,
      profile_name: result.profile.name,
      batch: true,
      count: updates.length,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] batch-update-agent-models error:', err.message);
    const status = err.message.includes('Unknown agent') || err.message.includes('not allowed') || err.message.includes('locked to provider')
      ? 400 : err.message.includes('No active profile') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ============================================================
// Device Lock API（部门主管架构 - 脚本员工设备互斥锁）
// ============================================================

/**
 * GET /api/brain/device-locks
 * 查看所有设备锁状态
 */
router.get('/device-locks', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT device_name, locked_by, locked_at, expires_at,
              (expires_at IS NOT NULL AND expires_at < NOW()) AS expired
       FROM device_locks
       ORDER BY device_name`
    );
    res.json({ success: true, locks: rows });
  } catch (err) {
    console.error('[API] device-locks GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/device-locks/acquire
 * 申请设备锁
 * body: { device_name, locked_by, ttl_minutes? }
 * 返回: { acquired: true, lock } 或 { acquired: false, locked_by, expires_at }
 */
router.post('/device-locks/acquire', async (req, res) => {
  try {
    const { device_name, locked_by, ttl_minutes = 30 } = req.body;
    if (!device_name || !locked_by) {
      return res.status(400).json({ success: false, error: 'device_name and locked_by are required' });
    }

    const expiresAt = new Date(Date.now() + ttl_minutes * 60 * 1000);

    // 先看设备是否存在
    const { rows: existing } = await pool.query(
      'SELECT device_name, locked_by, expires_at FROM device_locks WHERE device_name = $1',
      [device_name]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: `Unknown device: ${device_name}` });
    }

    const current = existing[0];
    const isLocked = current.locked_by && current.expires_at && new Date(current.expires_at) > new Date();

    if (isLocked) {
      return res.json({
        acquired: false,
        locked_by: current.locked_by,
        expires_at: current.expires_at,
      });
    }

    // 抢锁（包括已过期的锁）
    const { rows: updated } = await pool.query(
      `UPDATE device_locks
       SET locked_by = $1, locked_at = NOW(), expires_at = $2
       WHERE device_name = $3
       RETURNING *`,
      [locked_by, expiresAt, device_name]
    );

    res.json({ acquired: true, lock: updated[0] });
  } catch (err) {
    console.error('[API] device-locks/acquire error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/device-locks/release
 * 释放设备锁（只有持有者可以释放）
 * body: { device_name, locked_by }
 */
router.post('/device-locks/release', async (req, res) => {
  try {
    const { device_name, locked_by } = req.body;
    if (!device_name || !locked_by) {
      return res.status(400).json({ success: false, error: 'device_name and locked_by are required' });
    }

    const { rows } = await pool.query(
      `UPDATE device_locks
       SET locked_by = NULL, locked_at = NULL, expires_at = NULL
       WHERE device_name = $1 AND locked_by = $2
       RETURNING *`,
      [device_name, locked_by]
    );

    if (rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: `Device ${device_name} is not locked by ${locked_by}`,
      });
    }

    res.json({ success: true, released: rows[0] });
  } catch (err) {
    console.error('[API] device-locks/release error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

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
    const { publishDesireUpdated } = await import('./events/taskEvents.js');
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
    const { publishDesireUpdated } = await import('./events/taskEvents.js');
    publishDesireUpdated({ id, status: 'acknowledged', previous_status: 'pending', user_response: message.trim() });

    res.json({ success: true, desire_id: id, status: 'acknowledged' });
  } catch (err) {
    console.error('[API] desires/:id/respond error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/tasks/:id/dispatch
 * 手动派发单个任务（用户从前端点击"派发"按钮）
 * 跳过自动调度的 drain/billing/slot 检查，但保留执行器可用性检查
 */
router.post('/tasks/:id/dispatch', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. 查找任务
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'task not found' });
    }

    const task = taskResult.rows[0];

    // 2. 只允许 queued 状态的任务被派发
    if (task.status !== 'queued') {
      return res.status(409).json({
        error: `task status is '${task.status}', only 'queued' tasks can be dispatched`,
        current_status: task.status
      });
    }

    // 3. 更新为 in_progress
    await pool.query(
      `UPDATE tasks SET status = 'in_progress', updated_at = NOW(),
       metadata = COALESCE(metadata, '{}'::jsonb) || '{"manually_dispatched": true}'::jsonb
       WHERE id = $1`,
      [id]
    );

    // 4. 检查执行器可用性
    const ceceliaAvailable = await checkCeceliaRunAvailable();
    if (!ceceliaAvailable.available) {
      await pool.query(`UPDATE tasks SET status = 'queued', updated_at = NOW() WHERE id = $1`, [id]);
      return res.status(503).json({
        error: 'executor not available',
        detail: ceceliaAvailable.error
      });
    }

    // 5. 触发执行
    const execResult = await triggerCeceliaRun(task);
    if (!execResult.success) {
      await pool.query(`UPDATE tasks SET status = 'queued', updated_at = NOW() WHERE id = $1`, [id]);
      return res.status(500).json({
        error: 'dispatch failed',
        detail: execResult.error || execResult.reason
      });
    }

    res.json({
      success: true,
      task_id: id,
      title: task.title,
      run_id: execResult.runId
    });
  } catch (err) {
    console.error('[API] tasks/:id/dispatch error:', err.message);
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

    // 获取项目和Initiative统计
    const projectStatsResult = await pool.query(`
      SELECT
        type,
        status,
        COUNT(*) as count
      FROM projects
      WHERE type IN ('project', 'initiative')
      GROUP BY type, status
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
    const { runManualRumination } = await import('./rumination.js');
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
    const { getRuminationStatus } = await import('./rumination.js');
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
       ORDER BY created_at DESC
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

    const { getProgressSteps, getTaskProgressSummary } = await import('./progress-ledger.js');

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

    const { getProgressAnomalies } = await import('./progress-ledger.js');
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

    const { recordProgressStep } = await import('./progress-ledger.js');
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
    const result = await pool.query(`
      SELECT ge.id, ge.goal_id, ge.verdict, ge.metrics, ge.action_taken, ge.action_detail, ge.created_at,
             g.title AS goal_title, g.priority AS goal_priority, g.progress AS goal_progress
      FROM goal_evaluations ge
      JOIN goals g ON g.id = ge.goal_id
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
    const { getSelfModelRecord } = await import('./self-model.js');
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
export async function resolveRelatedFailureMemories(task_id, db) {
  // 1. 获取任务标题
  const taskRow = await db.query('SELECT title FROM tasks WHERE id = $1', [task_id]);
  if (!taskRow.rows[0]) return;

  const taskTitle = taskRow.rows[0].title;

  // 2. 从标题提取关键词（去掉常见词，取实质词汇）
  const stopWords = new Set(['fix', 'feat', 'add', 'update', 'the', 'a', 'an', 'and', 'or',
    '修复', '添加', '更新', '实现', '优化', '改进', '完成', '任务', '功能']);
  const keywords = taskTitle
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);

  if (keywords.length === 0) return;

  // 3. 在 failure_pattern learnings 中匹配关键词（有 source_memory_id 的才处理）
  const likeConditions = keywords.map((kw, i) => `(l.title ILIKE $${i + 2} OR l.content ILIKE $${i + 2})`);
  const likeParams = keywords.map(kw => `%${kw}%`);

  const learnings = await db.query(
    `SELECT l.id, l.source_memory_id
     FROM learnings l
     WHERE l.category = 'failure_pattern'
       AND l.source_memory_id IS NOT NULL
       AND l.archived = false
       AND (${likeConditions.join(' OR ')})
     LIMIT 10`,
    [task_id, ...likeParams]
  );

  if (learnings.rows.length === 0) {
    console.log(`[closure] No matching failure memories for task=${task_id}`);
    return;
  }

  // 4. 批量标记 memory_stream 为 resolved
  const memIds = learnings.rows.map(r => r.source_memory_id).filter(Boolean);
  if (memIds.length === 0) return;

  const placeholders = memIds.map((_, i) => `$${i + 3}`).join(', ');
  await db.query(
    `UPDATE memory_stream
     SET status = 'resolved',
         resolved_by_task_id = $1,
         resolved_at = NOW()
     WHERE id IN (${placeholders})
       AND status = 'active'`,
    [task_id, task_id, ...memIds]
  );

  console.log(`[closure] Resolved ${memIds.length} failure memories for task=${task_id} (keywords: ${keywords.join(',')})`);
}

export default router;
