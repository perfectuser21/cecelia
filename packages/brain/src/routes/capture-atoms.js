/**
 * /api/brain/capture-atoms — Capture Atoms CRUD + 路由确认
 *
 * GET  /api/brain/capture-atoms          — 列表（支持 ?status=pending_review&capture_id=）
 * GET  /api/brain/capture-atoms/:id      — 单条
 * PATCH /api/brain/capture-atoms/:id     — 更新（confirm/dismiss/edit）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// 三类系统产出来源（T10 统一收件箱）— 由 capture-triage tick 分诊，人工 confirm 不支持
const AUTO_TRIAGE_SOURCE_TYPES = ['handoff', 'learning', 'issue'];

// ─── GET /api/brain/capture-atoms ───────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { status, capture_id, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];

    if (status) {
      values.push(status);
      conditions.push(`ca.status = $${values.length}`);
    }
    if (capture_id) {
      values.push(capture_id);
      conditions.push(`ca.capture_id = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit, 10) || 50);
    values.push(parseInt(offset, 10) || 0);

    const sql = `
      SELECT
        ca.id, ca.capture_id, ca.content, ca.target_type, ca.target_subtype,
        ca.suggested_area_id, ca.status, ca.routed_to_table, ca.routed_to_id,
        ca.confidence, ca.created_at, ca.updated_at,
        c.content AS capture_content
      FROM capture_atoms ca
      LEFT JOIN captures c ON c.id = ca.capture_id
      ${where}
      ORDER BY ca.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `;

    const result = await pool.query(sql, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list capture_atoms', details: err.message });
  }
});

// ─── GET /api/brain/capture-atoms/:id ───────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ca.*, c.content AS capture_content
       FROM capture_atoms ca
       LEFT JOIN captures c ON c.id = ca.capture_id
       WHERE ca.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'capture_atom not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get capture_atom', details: err.message });
  }
});

// ─── PATCH /api/brain/capture-atoms/:id/confirm ─────────────────────────────
// FR-8 扩展：支持 action=reroute（清 ai_reason+改 nature+重路由）/ action=drop（转 dropped）
// Body: { action: 'confirm'|'dismiss'|'reroute'|'drop', nature?, target_type?, target_subtype?, route_to? }

router.patch('/:id/confirm', async (req, res) => {
  const { action = 'confirm', nature, target_type, target_subtype, route_to } = req.body;

  if (!['confirm', 'dismiss', 'reroute', 'drop'].includes(action)) {
    return res.status(400).json({ error: 'action must be confirm, dismiss, reroute, or drop' });
  }

  try {
    const atomResult = await pool.query('SELECT * FROM capture_atoms WHERE id = $1', [req.params.id]);
    if (atomResult.rows.length === 0) {
      return res.status(404).json({ error: 'capture_atom not found' });
    }
    const atom = atomResult.rows[0];

    if (action === 'drop') {
      await pool.query(
        `UPDATE capture_atoms SET status = 'dropped', updated_at = now() WHERE id = $1`,
        [atom.id]
      );
      return res.json({ id: atom.id, status: 'dropped' });
    }

    if (action === 'reroute') {
      // 清 ai_reason（重新进分诊队列），可选更新 nature
      const sets = ['ai_reason = NULL', 'status = \'pending_review\'', 'updated_at = now()'];
      const params = [atom.id];
      if (nature) {
        params.push(nature);
        sets.push(`nature = $${params.length}`);
      }
      if (route_to) {
        params.push(route_to);
        sets.push(`target_subtype = $${params.length}`);
      }
      await pool.query(`UPDATE capture_atoms SET ${sets.join(', ')} WHERE id = $1`, params);
      return res.json({ id: atom.id, status: 'pending_review', nature: nature || atom.nature, ai_reason: null });
    }

    if (action === 'dismiss') {
      await pool.query(
        `UPDATE capture_atoms SET status = 'dismissed', updated_at = now() WHERE id = $1`,
        [atom.id]
      );
      return res.json({ id: atom.id, status: 'dismissed' });
    }

    // action === 'confirm' — 向后兼容已有逻辑（简化版，不走 routeAtomToTarget）
    return res.json({ id: atom.id, status: atom.status, message: 'use PATCH /:id for full confirm routing' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process atom confirm', details: err.message });
  }
});

// ─── POST /api/brain/capture-atoms/:id/retry ─────────────────────────────────
// FR-8: 手动重试（清 ai_reason + retry_count+1）

router.post('/:id/retry', async (req, res) => {
  try {
    const atomResult = await pool.query('SELECT * FROM capture_atoms WHERE id = $1', [req.params.id]);
    if (atomResult.rows.length === 0) {
      return res.status(404).json({ error: 'capture_atom not found' });
    }
    const atom = atomResult.rows[0];
    const newRetryCount = (atom.retry_count || 0) + 1;

    await pool.query(
      `UPDATE capture_atoms
       SET ai_reason = NULL,
           status = 'pending_review',
           retry_count = $2,
           updated_at = now()
       WHERE id = $1`,
      [atom.id, newRetryCount]
    );

    return res.json({ id: atom.id, status: 'pending_review', retry_count: newRetryCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retry atom', details: err.message });
  }
});

// ─── PATCH /api/brain/capture-atoms/:id ─────────────────────────────────────
// Body: { action: 'confirm'|'dismiss', target_type?, target_subtype?, suggested_area_id? }
//
// confirm → 写入对应目标表，更新 atom status=confirmed + routed_to_table/id
// dismiss → 更新 atom status=dismissed

router.patch('/:id', async (req, res) => {
  const { action, target_type, target_subtype, suggested_area_id } = req.body;

  if (!action || !['confirm', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: 'action must be confirm or dismiss' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 读取 atom
    const atomResult = await client.query(
      'SELECT * FROM capture_atoms WHERE id = $1',
      [req.params.id]
    );
    if (atomResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'capture_atom not found' });
    }
    const atom = atomResult.rows[0];

    if (atom.status !== 'pending_review') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `atom status is ${atom.status}, not pending_review` });
    }

    if (action === 'dismiss') {
      await client.query(
        `UPDATE capture_atoms SET status = 'dismissed', updated_at = now() WHERE id = $1`,
        [atom.id]
      );
      await client.query('COMMIT');
      return res.json({ id: atom.id, status: 'dismissed' });
    }

    // action === 'confirm'
    const finalType = target_type || atom.target_type;
    const finalSubtype = target_subtype !== undefined ? target_subtype : atom.target_subtype;
    const finalAreaId = suggested_area_id !== undefined ? suggested_area_id : atom.suggested_area_id;

    // T10：三类系统产出来源由 capture-triage tick 自动分诊，不走人工 confirm 路由。
    // 守卫刻意检查请求覆盖后的 finalType（而非 atom.target_type）：人工改判 target_type
    // 为非自动分诊类型后即可走本路由——这是 triage 留箱（pending_review）条目的人工复核出路。
    if (AUTO_TRIAGE_SOURCE_TYPES.includes(finalType)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `target_type=${finalType} 由 capture-triage 自动分诊，不支持人工 confirm 路由`,
      });
    }

    const { routedTable, routedId } = await routeAtomToTarget(client, atom, finalType, finalSubtype, finalAreaId);

    // 更新 atom
    await client.query(
      `UPDATE capture_atoms
       SET status = 'confirmed',
           target_type = $2,
           target_subtype = $3,
           routed_to_table = $4,
           routed_to_id = $5,
           updated_at = now()
       WHERE id = $1`,
      [atom.id, finalType, finalSubtype, routedTable, routedId]
    );

    // 检查该 capture 的所有 atom 是否都已处理完（confirmed/dismissed）
    const pendingCheck = await client.query(
      `SELECT COUNT(*) FROM capture_atoms
       WHERE capture_id = $1 AND status = 'pending_review'`,
      [atom.capture_id]
    );
    if (parseInt(pendingCheck.rows[0].count, 10) === 0) {
      await client.query(
        `UPDATE captures SET status = 'done', updated_at = now() WHERE id = $1`,
        [atom.capture_id]
      );
    }

    await client.query('COMMIT');
    res.json({ id: atom.id, status: 'confirmed', routed_to_table: routedTable, routed_to_id: routedId });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to process atom', details: err.message });
  } finally {
    client.release();
  }
});

/**
 * 将 atom 写入对应目标表
 * @returns {{ routedTable: string, routedId: string }}
 */
async function routeAtomToTarget(client, atom, targetType, targetSubtype, areaId) {
  switch (targetType) {
    case 'notes': {
      const r = await client.query(
        `INSERT INTO notes (content, category, area_id, source)
         VALUES ($1, $2, $3, 'capture')
         RETURNING id`,
        [atom.content, targetSubtype || 'idea_note', areaId || null]
      );
      return { routedTable: 'notes', routedId: r.rows[0].id };
    }

    case 'knowledge': {
      const r = await client.query(
        `INSERT INTO knowledge (name, content, type, area_id, status)
         VALUES ($1, $2, $3, $4, 'Draft')
         RETURNING id`,
        [
          atom.content.slice(0, 100),
          atom.content,
          targetSubtype || 'insight',
          areaId || null,
        ]
      );
      return { routedTable: 'knowledge', routedId: r.rows[0].id };
    }

    case 'content_seed': {
      const r = await client.query(
        `INSERT INTO content_topics (title, body_draft, status)
         VALUES ($1, $2, 'pending')
         RETURNING id`,
        [atom.content.slice(0, 120), atom.content]
      );
      return { routedTable: 'content_topics', routedId: r.rows[0].id };
    }

    case 'task': {
      const r = await client.query(
        `INSERT INTO tasks (title, description, status, task_type, priority)
         VALUES ($1, $2, 'pending', 'dev', 'p2')
         RETURNING id`,
        [atom.content.slice(0, 200), atom.content]
      );
      return { routedTable: 'tasks', routedId: r.rows[0].id };
    }

    case 'decision': {
      const r = await client.query(
        `INSERT INTO decisions (title, description, status, area_id)
         VALUES ($1, $2, 'active', $3)
         RETURNING id`,
        [atom.content.slice(0, 200), atom.content, areaId || null]
      );
      return { routedTable: 'decisions', routedId: r.rows[0].id };
    }

    case 'event': {
      const r = await client.query(
        `INSERT INTO events (name, event_type, notes, area_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          atom.content.slice(0, 200),
          targetSubtype || 'general',
          atom.content,
          areaId || null,
        ]
      );
      return { routedTable: 'events', routedId: r.rows[0].id };
    }

    default:
      throw new Error(`Unknown target_type: ${targetType}`);
  }
}


// ─── PATCH /api/brain/capture-atoms/:id/confirm ─────────────────────────────
// 扩展：支持 reroute/drop action
router.patch('/:id/confirm', async (req, res) => {
  const { action, nature, target_type, target_subtype } = req.body;
  const validActions = ['confirm', 'dismiss', 'reroute', 'drop'];
  if (!action || !validActions.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
  }

  try {
    const atomResult = await pool.query('SELECT * FROM capture_atoms WHERE id = $1', [req.params.id]);
    if (atomResult.rows.length === 0) {
      return res.status(404).json({ error: 'capture_atom not found' });
    }
    const atom = atomResult.rows[0];

    if (action === 'drop') {
      await pool.query(
        `UPDATE capture_atoms SET status = 'dropped', updated_at = now() WHERE id = $1`,
        [atom.id]
      );
      return res.json({ id: atom.id, status: 'dropped' });
    }

    if (action === 'reroute') {
      // 清空 ai_reason，更新 nature（如有），重新进入分诊队列
      const updates = ['ai_reason = NULL', 'updated_at = now()', "status = 'pending_review'"];
      const params = [atom.id];
      if (nature) {
        params.push(nature);
        updates.push(`nature = $${params.length}`);
      }
      if (target_type) {
        params.push(target_type);
        updates.push(`target_type = $${params.length}`);
      }
      if (target_subtype !== undefined) {
        params.push(target_subtype);
        updates.push(`target_subtype = $${params.length}`);
      }
      await pool.query(`UPDATE capture_atoms SET ${updates.join(', ')} WHERE id = $1`, params);
      const updated = await pool.query('SELECT * FROM capture_atoms WHERE id = $1', [atom.id]);
      return res.json(updated.rows[0]);
    }

    if (action === 'dismiss') {
      await pool.query(
        `UPDATE capture_atoms SET status = 'dismissed', updated_at = now() WHERE id = $1`,
        [atom.id]
      );
      return res.json({ id: atom.id, status: 'dismissed' });
    }

    // action === 'confirm'（兜底）
    return res.json({ id: atom.id, status: atom.status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update capture_atom', details: err.message });
  }
});

// ─── POST /api/brain/capture-atoms/:id/retry ────────────────────────────────
router.post('/:id/retry', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE capture_atoms
       SET ai_reason = NULL, retry_count = COALESCE(retry_count, 0) + 1,
           status = 'pending_review', updated_at = now()
       WHERE id = $1
       RETURNING id, status, retry_count`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'capture_atom not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retry capture_atom', details: err.message });
  }
});

export default router;
