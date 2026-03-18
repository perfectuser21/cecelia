import { Router } from 'express';
import pool from '../db.js';
import { readFileSync, readdirSync } from 'fs';
import { callLLM } from '../llm-caller.js';
import { loadUserProfile, upsertUserProfile } from '../user-profile.js';
import { getRealtimeConfig, handleRealtimeTool } from '../orchestrator-realtime.js';
import { loadActiveProfile, getActiveProfile, switchProfile, listProfiles as listModelProfiles, updateAgentModel, batchUpdateAgentModels, updateAgentCascade } from '../model-profile.js';
import { getAccountUsage, selectBestAccount } from '../account-usage.js';
import websocketService, { WS_EVENTS } from '../websocket.js';
import { handleChat, handleChatStream } from '../orchestrator-chat.js';

const router = Router();


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
// POST /api/brain/immune/sweep - Manually trigger zombie sweep
// GET /api/brain/immune/status - Return last zombie sweep result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/brain/immune/sweep
 * Manually trigger a zombie sweep across all three dimensions.
 */
router.post('/immune/sweep', async (req, res) => {
  try {
    const { zombieSweep } = await import('../zombie-sweep.js');
    const result = await zombieSweep();
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[API] Failed to run zombie sweep:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to run zombie sweep',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/immune/status
 * Return the last zombie sweep result from working_memory.
 */
router.get('/immune/status', async (req, res) => {
  try {
    const { getZombieSweepStatus } = await import('../zombie-sweep.js');
    const status = await getZombieSweepStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (err) {
    console.error('[API] Failed to get zombie sweep status:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get zombie sweep status',
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
    const { message, context, messages, image_base64, image_media_type } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'message is required and must be a string',
      });
    }

    // 构建图片 content block（如有）
    const imageContent = image_base64
      ? [{ type: 'image', source: { type: 'base64', media_type: image_media_type || 'image/jpeg', data: image_base64 } }]
      : null;

    const result = await handleChat(message, context || {}, Array.isArray(messages) ? messages : [], imageContent);
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
 * POST /api/brain/orchestrator/chat/stream
 * Cecelia 嘴巴流式对话端点（SSE）
 *
 * Request: { message: string, context?: object, messages?: Array<{role, content}> }
 * Response: text/event-stream — 每行格式 `data: <chunk>\n\n`，结束为 `data: [DONE]\n\n`
 */
router.post('/orchestrator/chat/stream', async (req, res) => {
  const { message, context, messages, image_base64, image_media_type } = req.body;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Invalid request', message: 'message is required and must be a string' });
    return;
  }

  // 构建图片 content block（如有）
  const streamImageContent = image_base64
    ? [{ type: 'image', source: { type: 'base64', media_type: image_media_type || 'image/jpeg', data: image_base64 } }]
    : null;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // 禁用 nginx 缓冲
  res.flushHeaders();

  let closed = false;
  res.on('close', () => { closed = true; });

  try {
    if (streamImageContent) {
      // 有图片：stream provider 不支持 vision，降级为非流式 handleChat
      const result = await handleChat(message, context || {}, Array.isArray(messages) ? messages : [], streamImageContent);
      if (!closed) {
        const reply = result?.reply || '';
        if (reply) res.write(`data: ${JSON.stringify({ delta: reply })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } else {
    await handleChatStream(
      message,
      context || {},
      Array.isArray(messages) ? messages : [],
      (delta, isDone) => {
        if (closed) return;
        if (isDone) {
          res.write('data: [DONE]\n\n');
          res.end();
        } else if (delta) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }
    );
    }
  } catch (err) {
    console.error('[API] orchestrator/chat/stream error:', err.message);
    if (!closed) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

/**
 * POST /api/brain/diary
 * 废书端点 — 将用户的日记/碎碎念写入 memory_stream
 *
 * Request: { content: string }
 * Response: { ok: true, id: uuid }
 *
 * source_type='diary', importance=6, memory_type='reflection'
 * 使用 content_hash 去重（同一内容不重复写入）
 */
router.post('/diary', async (req, res) => {
  const { content } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const text = content.trim();

  try {
    const result = await pool.query(
      `INSERT INTO memory_stream (content, importance, memory_type, source_type)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [text, 6, 'reflection', 'diary']
    );

    console.log(`[diary] Saved to memory_stream id=${result.rows[0].id} len=${text.length}`);
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[diary] Error:', err.message);
    res.status(500).json({ error: err.message });
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
    const workersPath = '/Users/administrator/perfect21/cecelia/packages/workflows/staff/workers.config.json';
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

    const workersPath = '/Users/administrator/perfect21/cecelia/packages/workflows/staff/workers.config.json';
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
        const { loadActiveProfile } = await import('../model-profile.js');
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

// ==================== Account Best API ====================

/**
 * GET /api/brain/account/best
 * 返回当前最优可用账号（供 cecelia-claude wrapper 和外部工具调用）
 * 响应: { ok: true, account: "account2", model: "sonnet" }
 *       { ok: true, account: null, model: "minimax" }  当所有账号不可用时
 */
router.get('/account/best', async (_req, res) => {
  try {
    const best = await selectBestAccount();
    if (best) {
      res.json({ ok: true, account: best.accountId, model: best.model });
    } else {
      res.json({ ok: true, account: null, model: 'minimax' });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== Codex Usage API ====================

/**
 * GET /api/brain/codex-usage
 * 代理西安 codex-bridge 的 /accounts 端点，返回 5 个 Codex 账号用量
 */
let _codexUsageCache = null;
let _codexUsageFetchedAt = 0;
const CODEX_USAGE_TTL_MS = 3 * 60 * 1000; // 3 分钟缓存
const CODEX_BRIDGE_URL = process.env.XIAN_CODEX_BRIDGE_URL || 'http://100.86.57.69:3458';

router.get('/codex-usage', async (_req, res) => {
  try {
    const now = Date.now();
    if (_codexUsageCache && (now - _codexUsageFetchedAt) < CODEX_USAGE_TTL_MS) {
      return res.json({ ok: true, usage: _codexUsageCache, cached: true });
    }
    const resp = await fetch(`${CODEX_BRIDGE_URL}/accounts`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`codex-bridge returned ${resp.status}`);
    const data = await resp.json();
    _codexUsageCache = data.accounts || {};
    _codexUsageFetchedAt = now;
    res.json({ ok: true, usage: _codexUsageCache, cached: false });
  } catch (err) {
    // 返回缓存（即使过期）或空对象
    if (_codexUsageCache) {
      return res.json({ ok: true, usage: _codexUsageCache, cached: true, stale: true });
    }
    res.status(502).json({ ok: false, error: `codex-bridge unreachable: ${err.message}` });
  }
});

router.post('/codex-usage/refresh', async (_req, res) => {
  try {
    const resp = await fetch(`${CODEX_BRIDGE_URL}/accounts`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`codex-bridge returned ${resp.status}`);
    const data = await resp.json();
    _codexUsageCache = data.accounts || {};
    _codexUsageFetchedAt = Date.now();
    res.json({ ok: true, usage: _codexUsageCache });
  } catch (err) {
    res.status(502).json({ ok: false, error: `codex-bridge unreachable: ${err.message}` });
  }
});

// ==================== Memory Search API ====================

/**
 * POST /api/brain/memory-search
 * Claude Code 接口：语义检索 Cecelia memory_stream
 *
 * Request: { query: string, limit?: number (default 5) }
 * Response: { ok: true, matches: [{ content, memory_type, importance, summary, similarity }] }
 */
router.post('/memory-search', async (req, res) => {
  const { query, limit = 5 } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ ok: false, error: 'Missing required parameter: query' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const { generateEmbedding } = await import('../openai-client.js');
    const embedding = await generateEmbedding(query.trim().substring(0, 2000));
    const embStr = '[' + embedding.join(',') + ']';

    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 5), 20);

    const result = await pool.query(
      `SELECT content, memory_type, importance, summary,
              ROUND((1 - (embedding <=> $1::vector))::numeric, 4) AS similarity
       FROM memory_stream
       WHERE embedding IS NOT NULL
         AND status = 'active'
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embStr, safeLimit]
    );

    res.json({ ok: true, matches: result.rows });
  } catch (err) {
    console.error('[memory-search] error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== Runner Status API ====================

/**
 * GET /api/brain/runner-status
 * 实时返回 slot 状态（3区：user/cecelia/taskPool）
 * 每个活跃 slot 含 account/model/task_title/started_at
 */
router.get('/runner-status', async (_req, res) => {
  try {
    const { calculateSlotBudget } = await import('../slot-allocator.js');
    const budget = await calculateSlotBudget();

    const result = await pool.query(`
      SELECT id, title, task_type, status, started_at,
             payload->>'dispatched_account' AS account_id,
             payload->>'dispatched_model'   AS model,
             payload->>'decomposition'      AS decomposition,
             payload->>'requires_cortex'    AS requires_cortex
      FROM tasks
      WHERE status = 'in_progress'
      ORDER BY started_at ASC NULLS LAST
      LIMIT 20
    `);

    const now = Date.now();
    const tasks = result.rows.map(r => ({
      task_id:     r.id,
      task_title:  r.title,
      task_type:   r.task_type,
      account_id:  r.account_id || null,
      model:       r.model || null,
      started_at:  r.started_at,
      duration_ms: r.started_at ? now - new Date(r.started_at).getTime() : null,
      zone: (r.decomposition || r.requires_cortex === 'true') ? 'cecelia' : 'taskPool',
    }));

    const ceceliaTasks  = tasks.filter(t => t.zone === 'cecelia');
    const taskPoolTasks = tasks.filter(t => t.zone === 'taskPool');

    const buildSlots = (zoneTasks, capacity, zone) =>
      Array.from({ length: capacity }, (_, i) => {
        const t = zoneTasks[i];
        return t ? { slot: i + 1, zone, active: true, ...t } : { slot: i + 1, zone, active: false };
      });

    const ceceliaSlots  = buildSlots(ceceliaTasks,  budget.cecelia.budget,  'cecelia');
    const taskPoolSlots = buildSlots(taskPoolTasks,  budget.taskPool.budget, 'taskPool');
    const userSlots     = Array.from({ length: budget.user.budget }, (_, i) => ({
      slot: i + 1, zone: 'user', active: i < budget.user.used,
      task_title: i < budget.user.used ? '用户会话' : null,
    }));

    res.json({
      ok: true,
      total: budget.total,
      zones: {
        user:     { budget: budget.user.budget,     used: budget.user.used,     slots: userSlots },
        cecelia:  { budget: budget.cecelia.budget,  used: budget.cecelia.used,  slots: ceceliaSlots },
        taskPool: { budget: budget.taskPool.budget, used: budget.taskPool.used, slots: taskPoolSlots },
      },
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/brain/slot-recommendation
 * 动态推荐 slot 数：floor(剩余请求 / 预计剩余小时 / 平均请求每任务)
 */
router.get('/slot-recommendation', async (_req, res) => {
  try {
    const usage = await getAccountUsage();
    const accounts = Object.values(usage);
    const now = Date.now();

    const available = accounts.filter(a => (a.five_hour_pct ?? 0) < 90);
    const totalRemPct = available.reduce((s, a) => s + Math.max(0, 100 - (a.five_hour_pct ?? 0)), 0);
    const REQUESTS_PER_5H = 80;
    const remainingRequests = Math.round((totalRemPct / 100) * REQUESTS_PER_5H * Math.max(available.length, 1));

    let remainingHours = 5;
    const resetsAts = accounts.map(a => a.resets_at).filter(Boolean);
    if (resetsAts.length > 0) {
      const soonest = Math.min(...resetsAts.map(r => new Date(r).getTime()));
      remainingHours = Math.max(0.25, (soonest - now) / 3600000);
    }

    let avgRequestsPerTask = 6;
    try {
      const metricsResult = await pool.query(`
        SELECT AVG(est_requests) AS avg_req
        FROM task_execution_metrics
        WHERE recorded_at > NOW() - INTERVAL '24 hours'
          AND est_requests IS NOT NULL
      `);
      const avg = parseFloat(metricsResult.rows[0]?.avg_req);
      if (!isNaN(avg) && avg > 0) avgRequestsPerTask = Math.round(avg * 10) / 10;
    } catch { /* use default */ }

    const recommendedSlots = Math.max(1, Math.floor(remainingRequests / remainingHours / avgRequestsPerTask));

    res.json({
      ok: true,
      recommended_slots: recommendedSlots,
      formula: 'floor(remaining_requests / remaining_hours / avg_requests_per_task)',
      inputs: {
        remaining_requests:    remainingRequests,
        remaining_hours:       Math.round(remainingHours * 10) / 10,
        avg_requests_per_task: avgRequestsPerTask,
        available_accounts:    available.length,
      },
      updated_at: new Date().toISOString(),
    });
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
  const claudeDir = '/Users/administrator/.claude';
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

    const WORKFLOWS_BASE = '/Users/administrator/perfect21/cecelia/packages/workflows';

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
    const { MODELS, AGENTS } = await import('../model-registry.js');
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
    const { agent_id, model_id, provider } = req.body;
    if (!agent_id || !model_id) {
      return res.status(400).json({ success: false, error: 'agent_id and model_id are required' });
    }

    const result = await updateAgentModel(pool, agent_id, model_id, { provider });

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

router.patch('/model-profiles/active/agent-cascade', async (req, res) => {
  try {
    const { agent_id, cascade } = req.body;
    if (!agent_id) {
      return res.status(400).json({ success: false, error: 'agent_id is required' });
    }
    if (cascade !== null && !Array.isArray(cascade)) {
      return res.status(400).json({ success: false, error: 'cascade must be an array or null' });
    }

    const result = await updateAgentCascade(pool, agent_id, cascade);

    websocketService.broadcast(websocketService.WS_EVENTS.PROFILE_CHANGED, {
      profile_id: result.profile.id,
      profile_name: result.profile.name,
      agent_id: result.agent_id,
      cascade: result.cascade,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] update-agent-cascade error:', err.message);
    res.status(err.message.includes('No active profile') ? 404 : 500)
       .json({ success: false, error: err.message });
  }
});

// ============================================================
// Mouth Config API（嘴巴模型+调用方式独立切换）
// ============================================================

/**
 * GET /api/brain/mouth-config
 * 返回当前 mouth 的 model + provider
 */
router.get('/mouth-config', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT config FROM model_profiles WHERE is_active = true LIMIT 1'
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No active profile' });
    const cfg = rows[0].config;
    const mouth = cfg.mouth || {};
    res.json({ success: true, model: mouth.model || null, provider: mouth.provider || null });
  } catch (err) {
    console.error('[API] mouth-config GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/brain/mouth-config
 * 直接设置 mouth 的 model + provider（不经过 getProviderForModel 自动推导）
 * Body: { model: string, provider: "anthropic" | "anthropic-api" }
 */
router.patch('/mouth-config', async (req, res) => {
  try {
    const { model, provider } = req.body;
    const ALLOWED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];
    const ALLOWED_PROVIDERS = ['anthropic', 'anthropic-api'];
    if (!ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ success: false, error: `Invalid model: ${model}` });
    }
    if (!ALLOWED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ success: false, error: `Invalid provider: ${provider}` });
    }

    const { rows } = await pool.query(
      'SELECT id, config FROM model_profiles WHERE is_active = true LIMIT 1'
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No active profile' });

    const profile = rows[0];
    const config = { ...profile.config, mouth: { model, provider } };
    await pool.query(
      'UPDATE model_profiles SET config = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(config), profile.id]
    );

    // 刷新内存缓存
    const { loadActiveProfile } = await import('../model-profile.js');
    await loadActiveProfile(pool);

    console.log(`[API] mouth-config updated → model=${model} provider=${provider}`);
    res.json({ success: true, model, provider });
  } catch (err) {
    console.error('[API] mouth-config PATCH error:', err.message);
    res.status(500).json({ success: false, error: err.message });
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

export default router;
