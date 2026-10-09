/**
 * Spans：执行机按 Activity / Step / Enabler 上报执行段（价值流建模④，决策 3e867cad，任务 ec643d60）。
 *
 * POST /api/brain/spans   内网/回环鉴权；body 单条或数组；整批事务写入，发生位置同内容幂等、异内容409，旧客户端原键兼容
 * GET  /api/brain/spans   ?run_id=（必填）&activity_id=（可选）按 started_at 排序
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { normalizeSpan, optionalUuid, writeSpans } from '../lib/span-ingestion.js';

const router = Router();

router.post('/spans', internalAuthOrLoopback, async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  if (items.length === 0) return res.status(400).json({ error: 'body must be a span or a non-empty array of spans' });

  let rows;
  try {
    rows = items.map(normalizeSpan);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message,...(e.code?.startsWith('SPAN_')?{code:e.code}:{}) });
  }

  try {
    return res.json(await writeSpans(pool, rows));
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message,
      ...(e.code?.startsWith('SPAN_') ? { code: e.code, run_id: e.run_id, occurrence_key: e.occurrence_key } : {}),
    });
  }
});

router.get('/spans', async (req, res) => {
  const runId = typeof req.query.run_id === 'string' ? req.query.run_id.trim() : '';
  if (!runId) return res.status(400).json({ error: 'run_id is required' });
  let activityId;
  try {
    activityId = optionalUuid(req.query.activity_id, 'activity_id');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const params = [runId];
  let sql = 'SELECT * FROM spans WHERE run_id = $1';
  if (activityId) {
    params.push(activityId);
    sql += ' AND activity_id = $2';
  }
  sql += ' ORDER BY started_at ASC, created_at ASC';

  try {
    const r = await pool.query(sql, params);
    return res.json({ spans: r.rows, total: r.rows.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
