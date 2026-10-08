/**
 * GET   /api/brain/steps              — Step 只读清单（仓库 step-dod.json 为真身，迁移 492 表）。
 * GET   /api/brain/enablers           — 仓库物件清单（迁移 492 表；/warehouse-items 为别名）。
 * PATCH /api/brain/enablers/:key      — 写仓库物件的故障处置 failure_semantics（内部鉴权）。
 * GET   /api/brain/activity_uses      — 某 Activity 依赖的仓库物件（含故障处置）。
 * 价值流建模⑤（决策 3e867cad，任务 741cdf5a）：sync-step-probes 用 ?key= 把 YAML 里的 target:{type,key} 解析成 target_id。
 * 技能工厂故障处置表（决策 1b469079，任务 dca8ebda）：运行时按依赖对象取片（?keys= / activity_uses），四分类沿用 activities.failure。
 * 过滤：steps ?key= / ?activity_id=<uuid> / ?active=all；enablers ?key= / ?keys=a,b / ?active=all。
 */
import { Router } from 'express';
import pool from '../db.js';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILURE_CLASSES = new Set(['empty_ok', 'retryable', 'fatal', 'needs_human']);

// warehouse_items.failure_semantics 是 text 列：本接口写入的是 JSON 文本，读出时能解析就给对象，旧的纯文本原样给
function parseFailureSemantics(row) {
  if (typeof row.failure_semantics !== 'string') return row;
  try {
    return { ...row, failure_semantics: JSON.parse(row.failure_semantics) };
  } catch {
    return row;
  }
}

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
  const { key, keys, active } = req.query;
  const where = [];
  const params = [];
  if (key !== undefined) { params.push(String(key)); where.push(`key = $${params.length}`); }
  if (keys !== undefined) {
    params.push(String(keys).split(',').map((k) => k.trim()).filter(Boolean));
    where.push(`key = ANY($${params.length})`);
  }
  if (active !== 'all') where.push('active = true');
  try {
    const { rows } = await pool.query(
      `SELECT id, key, name, kind, shelf, impl_ref, owner, description, failure_semantics, active, created_at, updated_at
         FROM warehouse_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY key`,
      params,
    );
    res.json({ enablers: rows.map(parseFailureSemantics), count: rows.length });
  } catch (err) {
    console.error('[steps] GET /enablers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// failure_semantics = { rows: [{ symptom, class, wait_s?, retries?, before_retry?, then?, evidence? }] }
function validateFailureSemantics(fs) {
  if (!fs || typeof fs !== 'object' || !Array.isArray(fs.rows) || fs.rows.length === 0) {
    return 'failure_semantics.rows 必须是非空数组';
  }
  for (const [i, row] of fs.rows.entries()) {
    if (!row || typeof row.symptom !== 'string' || !row.symptom.trim()) return `rows[${i}].symptom 不能为空`;
    if (!FAILURE_CLASSES.has(row.class)) return `rows[${i}].class 必须是 ${[...FAILURE_CLASSES].join(' / ')} 之一`;
  }
  return null;
}

router.patch('/enablers/:key', internalAuthOrLoopback, async (req, res) => {
  const fs = (req.body || {}).failure_semantics;
  const invalid = validateFailureSemantics(fs);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    const { rows } = await pool.query(
      `UPDATE warehouse_items
          SET failure_semantics = $1, updated_at = NOW()
        WHERE key = $2
        RETURNING id, key, name, shelf, failure_semantics, updated_at`,
      [JSON.stringify(fs), String(req.params.key)],
    );
    if (!rows.length) return res.status(404).json({ error: 'warehouse item not found' });
    res.json(parseFailureSemantics(rows[0]));
  } catch (err) {
    console.error('[steps] PATCH /enablers/:key error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/activity_uses', async (req, res) => {
  const activityId = req.query.activity_id;
  if (!UUID_RE.test(String(activityId || ''))) return res.status(400).json({ error: 'activity_id 必须是 uuid' });
  try {
    const { rows } = await pool.query(
      `SELECT u.activity_id, u.role, u.cell_status, i.id AS item_id, i.key AS item_key, i.name AS item_name,
              i.shelf, i.failure_semantics
         FROM activity_uses u
         JOIN warehouse_items i ON i.id = u.item_id
        WHERE u.activity_id = $1
        ORDER BY i.key`,
      [String(activityId)],
    );
    res.json({ uses: rows.map(parseFailureSemantics), count: rows.length });
  } catch (err) {
    console.error('[steps] GET /activity_uses error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
