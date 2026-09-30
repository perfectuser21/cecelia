/**
 * GET /api/brain/workflows — Workflow 只读清单（价值流建模③，决策 3e867cad / 752b7166，任务 ce41cd59）。
 * Workflow = 一个 Capability（有父的 journey）在某渠道/形态上的可执行链条；每行带能力名、所属价值流、挂在它上面的骨干活动数。
 * 过滤：?capability_id=<uuid> / ?value_stream_id=<uuid>（= 能力的父 journey）/ ?status=active|paused|retired。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['active', 'paused', 'retired']);

router.get('/workflows', async (req, res) => {
  const { capability_id: capabilityId, value_stream_id: valueStreamId, status } = req.query;
  const where = [];
  const params = [];
  if (capabilityId !== undefined) {
    if (!UUID_RE.test(String(capabilityId))) return res.status(400).json({ error: 'capability_id 必须是 uuid' });
    params.push(String(capabilityId));
    where.push(`w.capability_id = $${params.length}`);
  }
  if (valueStreamId !== undefined) {
    if (!UUID_RE.test(String(valueStreamId))) return res.status(400).json({ error: 'value_stream_id 必须是 uuid' });
    params.push(String(valueStreamId));
    where.push(`c.parent_journey_id = $${params.length}`);
  }
  if (status !== undefined) {
    if (!STATUSES.has(String(status))) return res.status(400).json({ error: 'status 只支持 active|paused|retired' });
    params.push(String(status));
    where.push(`w.status = $${params.length}`);
  }
  const sql = `SELECT w.id, w.key, w.name, w.channel, w.form, w.version, w.status, w.capability_id,
                      c.name AS capability_name, c.parent_journey_id AS value_stream_id,
                      (SELECT count(*)::int FROM journey_steps js WHERE js.workflow_id = w.id) AS activity_count,
                      w.created_at, w.updated_at
                 FROM workflows w
                 JOIN journeys c ON c.id = w.capability_id
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY w.key`;
  try {
    const r = await pool.query(sql, params);
    return res.json({ workflows: r.rows, total: r.rows.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
