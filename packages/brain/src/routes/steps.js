/**
 * GET /api/brain/steps    — Step 只读清单（仓库 step-dod.json 为真身，迁移 492 表）。
 * GET /api/brain/enablers — 使能件只读清单（迁移 492 表）。
 * 价值流建模⑤（决策 3e867cad，任务 741cdf5a）：sync-step-probes 用 ?key= 把 YAML 里的 target:{type,key} 解析成 target_id。
 * 过滤：steps ?key= / ?activity_id=<uuid> / ?active=all；enablers ?key= / ?active=all。
 */
import { Router } from 'express';
import pool from '../db.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/steps', async (req, res) => {
  const { key, activity_id: activityId, active } = req.query;
  const where = [];
  const params = [];
  if (key !== undefined) { params.push(String(key)); where.push(`key = $${params.length}`); }
  if (activityId !== undefined) {
    if (!UUID_RE.test(String(activityId))) return res.status(400).json({ error: 'activity_id 必须是 uuid' });
    params.push(String(activityId));
    where.push(`activity_id = $${params.length}`);
  }
  if (active !== 'all') where.push('active = true');
  try {
    const { rows } = await pool.query(
      `SELECT id, activity_id, step_order, key, activity_key, mode, readback, contract, source_sha256, active, created_at, updated_at
         FROM steps ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY activity_id, step_order`,
      params,
    );
    res.json({ steps: rows, count: rows.length });
  } catch (err) {
    console.error('[steps] GET /steps error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/enablers', async (req, res) => {
  const { key, active } = req.query;
  const where = [];
  const params = [];
  if (key !== undefined) { params.push(String(key)); where.push(`key = $${params.length}`); }
  if (active !== 'all') where.push('active = true');
  try {
    const { rows } = await pool.query(
      `SELECT id, key, name, kind, impl_ref, owner, description, active, created_at, updated_at
         FROM warehouse_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY key`,
      params,
    );
    res.json({ enablers: rows, count: rows.length });
  } catch (err) {
    console.error('[steps] GET /enablers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
