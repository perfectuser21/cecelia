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

export default router;
