import { Router } from 'express';
import pool from '../db.js';
import { getDailyFocus, setDailyFocus, clearDailyFocus, getFocusSummary } from '../focus.js';
import { getTickStatus, TASK_TYPE_AGENT_MAP } from '../tick.js';
import { getDispatchStats } from '../dispatch-stats.js';
import { getActivePolicy, getWorkingMemory, getTopTasks, getRecentDecisions, IDEMPOTENCY_TTL, ALLOWED_ACTIONS } from './shared.js';
import { getNightlyOrchestratorStatus } from '../nightly-orchestrator.js';
import websocketService from '../websocket.js';

const router = Router();

const N8N_API_URL = process.env.N8N_API_URL || 'http://localhost:5679';

async function checkN8nHealth() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`${N8N_API_URL}/healthz`, { signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
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

    const [policy, workingMemory, topTasks, recentDecisions, dailyFocus, n8nAlive] = await Promise.all([
      getActivePolicy(),
      getWorkingMemory(),
      getTopTasks(10),
      getRecentDecisions(5),
      getFocusSummary(),
      checkN8nHealth()
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
        n8n_ok: n8nAlive,
        n8n_failures_1h: 0,
        task_system_ok: true,
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
      nightly_orchestrator: getNightlyOrchestratorStatus(),
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
    const sprintDir = req.query.sprint_dir || null;

    // If filters provided, use custom query instead of getTopTasks
    if (status || task_type || sprintDir) {
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

      if (sprintDir) {
        query += ` AND sprint_dir = $${paramIndex}`;
        params.push(sprintDir);
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
 * 查询 goals 列表（从新 OKR 表：objectives + key_results UNION ALL）
 * Query params:
 *   dept: 按 metadata->>'dept' 过滤（可选）
 */
router.get('/goals', async (req, res) => {
  try {
    const { dept } = req.query;
    const params = [];
    let whereClause = '';
    if (dept) {
      params.push(dept);
      whereClause = ` WHERE metadata->>'dept' = $1`;
    }
    const query = `
      SELECT id, 'area_okr'::text AS type, title, status,
             NULL::text AS priority, NULL::numeric AS progress, NULL::numeric AS weight,
             NULL::uuid AS parent_id, metadata, custom_props, created_at, updated_at
      FROM objectives${whereClause}
      UNION ALL
      SELECT id, 'area_kr'::text AS type, title, status,
             NULL::text AS priority,
             CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress,
             NULL::numeric AS weight,
             objective_id AS parent_id, metadata, custom_props, created_at, updated_at
      FROM key_results${whereClause}
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, dept ? [...params, ...params] : params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get goals', details: err.message });
  }
});

/**
 * POST /api/brain/goals/:id/approve
 * 用户放行 KR（reviewing → ready）。
 * 先查 key_results，若不存在再查 objectives（向后兼容）。
 */
router.post('/goals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;

    // 优先更新 key_results（task-router.js 使用此表调度）
    let result = await pool.query(
      `UPDATE key_results SET status = 'ready', updated_at = NOW()
       WHERE id = $1 AND status = 'reviewing'
       RETURNING id, title, status`,
      [id]
    );

    // 若 key_results 未找到，尝试 objectives
    if (result.rows.length === 0) {
      result = await pool.query(
        `UPDATE objectives SET status = 'ready', updated_at = NOW()
         WHERE id = $1 AND status = 'reviewing'
         RETURNING id, title, status`,
        [id]
      );
    }

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

/**
 * GET /api/brain/goals/:id/okr-context
 * 返回 KR 的完整 OKR 上下文：父 Objective + 同级 KR + 相似历史 KR + 支撑 learnings
 * 迁移：旧 goals 表 → key_results（KR）+ objectives（Objective）
 */
router.get('/goals/:id/okr-context', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. 取本 KR（先查 key_results，再查 objectives）
    let krResult = await pool.query(
      `SELECT id, title, 'area_kr'::text AS type, status,
              NULL::text AS priority,
              CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress,
              objective_id AS parent_id, metadata
       FROM key_results WHERE id = $1`,
      [id]
    );
    if (krResult.rows.length === 0) {
      krResult = await pool.query(
        `SELECT id, title, 'area_okr'::text AS type, status,
                NULL::text AS priority, NULL::numeric AS progress,
                NULL::uuid AS parent_id, metadata
         FROM objectives WHERE id = $1`,
        [id]
      );
    }
    if (krResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const kr = krResult.rows[0];

    // 2. 取父 Objective（从 objectives 表）
    let objective = null;
    if (kr.parent_id) {
      const obj = await pool.query(
        `SELECT id, title, 'area_okr'::text AS type, status, NULL::numeric AS progress
         FROM objectives WHERE id = $1`,
        [kr.parent_id]
      );
      objective = obj.rows[0] || null;
    }

    // 3. 取同级 KR（同一 objective_id 下的其他 key_results）
    const siblings = kr.parent_id ? (await pool.query(
      `SELECT id, title, 'area_kr'::text AS type, status,
              NULL::text AS priority,
              CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress
       FROM key_results
       WHERE objective_id = $1 AND id != $2 ORDER BY created_at ASC`,
      [kr.parent_id, id]
    )).rows : [];

    // 4. 相似历史 KR（标题关键词重叠，排除当前 KR）
    const words = (kr.title || '').split(/[\s，。、\-_]+/).filter(w => w.length > 1).slice(0, 5);
    let similarKrs = [];
    if (words.length > 0) {
      const likeClause = words.map((_, i) => `title ILIKE $${i + 2}`).join(' OR ');
      similarKrs = (await pool.query(
        `SELECT id, title, 'area_kr'::text AS type, status,
                CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress,
                created_at
         FROM key_results
         WHERE id != $1 AND (${likeClause})
         ORDER BY created_at DESC LIMIT 5`,
        [id, ...words.map(w => `%${w}%`)]
      )).rows;
    }

    // 5. 支撑 learnings（关键词匹配标题或内容，LIMIT 3）
    let learnings = [];
    if (words.length > 0) {
      const lLikeClause = words.map((_, i) => `(title ILIKE $${i + 1} OR content ILIKE $${i + 1})`).join(' OR ');
      learnings = (await pool.query(
        `SELECT id, title, content, category, created_at FROM learnings
         WHERE ${lLikeClause}
         ORDER BY created_at DESC LIMIT 3`,
        [...words.map(w => `%${w}%`)]
      )).rows;
    }

    res.json({ success: true, kr, objective, siblings, similar_krs: similarKrs, learnings });
  } catch (err) {
    console.error('[goals/okr-context] Error:', err.message);
    res.status(500).json({ error: 'Failed to get OKR context', details: err.message });
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

export default router;
