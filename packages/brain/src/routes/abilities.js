import express from 'express';
import pool from '../db.js';

const router = express.Router();

const ABILITY_KINDS = ['ability', 'feature'];
const ABILITY_STATUS = ['working', 'broken', 'planned', 'building', 'done', 'deprecated'];
const DECISION_LEVELS = ['area', 'ability', 'feature', 'step'];

// ---------- abilities (基于 journey_features WHERE kind 筛选) ----------

// GET /api/brain/abilities
router.get('/abilities', async (req, res) => {
  try {
    const { area, journey_id, kind, status, limit = 200 } = req.query;
    const params = [];
    const clauses = [];
    if (area)       {
      params.push(area.toLowerCase());
      clauses.push(`area_id=(SELECT id FROM areas WHERE LOWER(name)=$${params.length} LIMIT 1)`);
    }
    if (journey_id) { params.push(journey_id); clauses.push(`journey_id=$${params.length}`); }
    if (kind)       { params.push(kind);       clauses.push(`kind=$${params.length}`); }
    if (status)     { params.push(status);     clauses.push(`status=$${params.length}`); }
    params.push(Math.min(parseInt(limit, 10) || 200, 500));
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM journey_features ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /abilities error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/abilities
router.post('/abilities', async (req, res) => {
  try {
    const { name, area, journey_id, kind, workflow_ref, status } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (kind && !ABILITY_KINDS.includes(kind))
      return res.status(400).json({ error: `kind must be one of: ${ABILITY_KINDS.join(',')}` });
    if (status && !ABILITY_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ABILITY_STATUS.join(',')}` });
    let area_id = null;
    if (area) {
      const areaRow = await pool.query(
        `SELECT id FROM areas WHERE LOWER(name)=LOWER($1) LIMIT 1`, [area]
      );
      area_id = areaRow.rows[0]?.id || null;
    }
    const { rows } = await pool.query(
      `INSERT INTO journey_features (name, area_id, journey_id, kind, workflow_ref, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, area_id, journey_id || null, kind || 'ability', workflow_ref || null, status || 'planned']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[abilities] POST /abilities error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/abilities/:id
router.patch('/abilities/:id', async (req, res) => {
  try {
    const { name, kind, workflow_ref, status } = req.body;
    if (kind && !ABILITY_KINDS.includes(kind))
      return res.status(400).json({ error: `kind must be one of: ${ABILITY_KINDS.join(',')}` });
    if (status && !ABILITY_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ABILITY_STATUS.join(',')}` });
    const sets = [], vals = []; let idx = 1;
    if (name)         { sets.push(`name=$${idx++}`);         vals.push(name); }
    if (kind)         { sets.push(`kind=$${idx++}`);         vals.push(kind); }
    if (workflow_ref) { sets.push(`workflow_ref=$${idx++}`); vals.push(workflow_ref); }
    if (status)       { sets.push(`status=$${idx++}`);       vals.push(status); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push(`updated_at=NOW()`);
    sets.push(`notion_synced_at=NULL`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE journey_features SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[abilities] PATCH /abilities/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- decisions (level/target_type/target_id/scope 分层决策) ----------

// POST /api/brain/decisions — 写 ability/feature 级决策
router.post('/decisions', async (req, res) => {
  try {
    const { category, topic, decision, reason, level, target_type, target_id, scope } = req.body;
    if (!level || !DECISION_LEVELS.includes(level))
      return res.status(400).json({ error: `level must be one of: ${DECISION_LEVELS.join(',')}` });
    // target_type=journey_feature 时 target_id 必须真实存在于 journey_features
    if (target_type === 'journey_feature') {
      if (!target_id)
        return res.status(400).json({ error: 'target_id is required when target_type=journey_feature' });
      let exists;
      try {
        exists = await pool.query('SELECT id FROM journey_features WHERE id=$1', [target_id]);
      } catch {
        // 非法 uuid 格式 → 视为不存在的 target_id（400 而非 500）
        return res.status(400).json({ error: `invalid target_id: ${target_id}` });
      }
      if (!exists.rows.length)
        return res.status(400).json({ error: `target_id not found in journey_features: ${target_id}` });
    }
    // target_type=golden_path 时 target_id 必须真实存在于 golden_path（step 级 NFR 决策不可悬空）
    if (target_type === 'golden_path') {
      if (!target_id)
        return res.status(400).json({ error: 'target_id is required when target_type=golden_path' });
      let exists;
      try {
        exists = await pool.query('SELECT id FROM golden_path WHERE id=$1', [target_id]);
      } catch {
        // 非法 uuid 格式 → 视为不存在的 target_id（400 而非 500）
        return res.status(400).json({ error: `invalid target_id: ${target_id}` });
      }
      if (!exists.rows.length)
        return res.status(400).json({ error: `target_id not found in golden_path: ${target_id}` });
    }
    const { rows } = await pool.query(
      `INSERT INTO decisions (category, topic, decision, reason, level, target_type, target_id, scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [category || null, topic || null, decision || null, reason || null,
       level, target_type || null, target_id || null, scope || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[abilities] POST /decisions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/abilities/:id/decisions?scope=v1 — 读某 ability 的决策清单
router.get('/abilities/:id/decisions', async (req, res) => {
  try {
    const { scope } = req.query;
    const params = [req.params.id];
    let sql = `SELECT * FROM decisions WHERE target_type='journey_feature' AND target_id=$1`;
    if (scope) { params.push(scope); sql += ` AND scope=$${params.length}`; }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /abilities/:id/decisions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- golden_path（唯一正模型：每个 Task 一条 Golden Path，owner_task_id + order_no + feature_id）----------

// GET /api/brain/golden_path?owner_task_id=...  — 列某 task 整条 golden path 的步骤（按 order_no）
router.get('/golden_path', async (req, res) => {
  try {
    const { owner_task_id, limit = 200 } = req.query;
    const params = [];
    const clauses = [];
    if (owner_task_id) { params.push(owner_task_id); clauses.push(`owner_task_id=$${params.length}`); }
    params.push(Math.min(parseInt(limit, 10) || 200, 500));
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM golden_path ${where} ORDER BY order_no ASC LIMIT $${params.length}`, params
    );
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /golden_path error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/golden_path — 建一条 golden path 步（带 owner_task 存在性校验，不可悬空）
router.post('/golden_path', async (req, res) => {
  try {
    const { owner_task_id, order_no, feature_id, note } = req.body;
    if (!owner_task_id || order_no == null)
      return res.status(400).json({ error: 'owner_task_id, order_no are required' });
    // owner_task_id 必须真实存在于 tasks（非法 uuid → 400 而非 500）
    let taskExists;
    try {
      taskExists = await pool.query('SELECT id FROM tasks WHERE id=$1', [owner_task_id]);
    } catch {
      return res.status(400).json({ error: `invalid owner_task_id: ${owner_task_id}` });
    }
    if (!taskExists.rows.length)
      return res.status(400).json({ error: `owner_task_id not found in tasks: ${owner_task_id}` });
    const { rows } = await pool.query(
      `INSERT INTO golden_path (owner_task_id, order_no, feature_id, note)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [owner_task_id, order_no, feature_id || null, note || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[abilities] POST /golden_path error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/golden_path/:id
router.patch('/golden_path/:id', async (req, res) => {
  try {
    const { order_no, feature_id, note } = req.body;
    const sets = [], vals = []; let idx = 1;
    if (order_no != null) { sets.push(`order_no=$${idx++}`);   vals.push(order_no); }
    if (feature_id)       { sets.push(`feature_id=$${idx++}`); vals.push(feature_id); }
    if (note != null)     { sets.push(`note=$${idx++}`);       vals.push(note); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE golden_path SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[abilities] PATCH /golden_path/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- golden_path 决策读回视图（step 级 NFR 验收单）----------

// GET /api/brain/golden_path/:id/decisions?scope=v1 — 读某 golden path 步上挂的决策清单
//   无匹配返回空数组（200，不报错）
router.get('/golden_path/:id/decisions', async (req, res) => {
  try {
    const { scope, category } = req.query;
    const params = [req.params.id];
    let sql = `SELECT * FROM decisions WHERE target_type='golden_path' AND target_id=$1`;
    if (scope)    { params.push(scope);    sql += ` AND scope=$${params.length}`; }
    if (category) { params.push(category); sql += ` AND category=$${params.length}`; }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /golden_path/:id/decisions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/tasks/:id/golden-path-decisions?category=nfr&scope=v1
//   按 owner_task_id join 出该 task 整条 golden path 各步骤上挂的决策（NFR 验收单）
//   每行附 order_no 便于按步骤顺序读；无匹配返回空数组（200，不报错）
router.get('/tasks/:id/golden-path-decisions', async (req, res) => {
  try {
    const { category, scope } = req.query;
    const params = [req.params.id];
    let sql = `
      SELECT d.*, gp.order_no
      FROM decisions d
      JOIN golden_path gp ON gp.id = d.target_id
      WHERE d.target_type='golden_path' AND gp.owner_task_id=$1`;
    if (category) { params.push(category); sql += ` AND d.category=$${params.length}`; }
    if (scope)    { params.push(scope);    sql += ` AND d.scope=$${params.length}`; }
    sql += ` ORDER BY gp.order_no ASC, d.created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /tasks/:id/golden-path-decisions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
