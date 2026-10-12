import { Router } from 'express';
import pool from '../db.js';

const router = Router();
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SOURCE = /^[A-Za-z0-9][A-Za-z0-9_.:" -]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = new Set(['session_id', 'kind', 'launched_by', 'task_id']);
const COLUMNS = 'session_id, kind, launched_by, task_id, created_at';

// 启动器只提交出处元数据。重复启动保持首条记录，不能把机器来源改写成人类。
router.post('/', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !FIELDS.has(key))
    || typeof body.session_id !== 'string' || !SESSION_ID.test(body.session_id)
    || !['human', 'machine'].includes(body.kind)
    || typeof body.launched_by !== 'string' || !SOURCE.test(body.launched_by)
    || (body.task_id != null && (typeof body.task_id !== 'string' || !UUID.test(body.task_id)))) {
    return res.status(400).json({ error: 'invalid_session_provenance' });
  }
  try {
    const inserted = await pool.query(
      `INSERT INTO session_provenance (session_id, kind, launched_by, task_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (session_id) DO NOTHING RETURNING ${COLUMNS}`,
      [body.session_id, body.kind, body.launched_by, body.task_id ?? null],
    );
    if (inserted.rows.length) return res.status(201).json(inserted.rows[0]);
    const existing = await pool.query(`SELECT ${COLUMNS} FROM session_provenance WHERE session_id = $1`, [body.session_id]);
    return res.status(200).json(existing.rows[0]);
  } catch {
    return res.status(503).json({ error: 'session_provenance_unavailable' });
  }
});

router.get('/:sessionId', async (req, res) => {
  if (!SESSION_ID.test(req.params.sessionId)) return res.status(400).json({ error: 'invalid_session_id' });
  try {
    const result = await pool.query(`SELECT ${COLUMNS} FROM session_provenance WHERE session_id = $1`, [req.params.sessionId]);
    if (!result.rows.length) return res.status(404).json({ error: 'session_provenance_not_found' });
    return res.json(result.rows[0]);
  } catch {
    return res.status(503).json({ error: 'session_provenance_unavailable' });
  }
});

export default router;
