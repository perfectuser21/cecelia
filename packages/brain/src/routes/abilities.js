import express from 'express';
import pool from '../db.js';
import { computeProgress } from '../advancement-progress.js';

const router = express.Router();

const ABILITY_KINDS = ['ability', 'feature'];
const ABILITY_STATUS = ['working', 'broken', 'planned', 'building', 'done', 'deprecated'];
const DECISION_LEVELS = ['area', 'ability', 'feature', 'step'];
const ADVANCEMENT_STATUS = ['todo', 'doing', 'done'];

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

// ---------- A1 P0 端点（harness 验证模型重构 HANDOFF 第 5 节）----------

// GET /api/brain/journeys/:journey_id/golden-paths?status=done
//   按 line 聚合已验收 ability 的 golden_path（累积 FR）。
//   桥：golden_path.owner_task_id → tasks.ability_id → journey_features.journey_id。
//   按 owner_task_id 分组（ability:run=1:N，按 ability 分组会让不同 task 的 order_no 交错）。
//   无匹配返回空数组（200，不报错）。
router.get('/journeys/:journey_id/golden-paths', async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !ABILITY_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ABILITY_STATUS.join(',')}` });
    const params = [req.params.journey_id];
    let sql = `
      SELECT jf.id AS ability_id, jf.name AS ability_name, jf.status AS ability_status,
             gp.owner_task_id, gp.id, gp.order_no, gp.feature_id, gp.note
      FROM golden_path gp
      JOIN tasks t ON gp.owner_task_id = t.id
      JOIN journey_features jf ON t.ability_id = jf.id
      WHERE jf.journey_id = $1`;
    if (status) { params.push(status); sql += ` AND jf.status = $${params.length}`; }
    sql += ` ORDER BY gp.owner_task_id, gp.order_no ASC`;
    let rows;
    try {
      ({ rows } = await pool.query(sql, params));
    } catch (err) {
      if (err.code === '22P02')
        return res.status(400).json({ error: `invalid journey_id: ${req.params.journey_id}` });
      throw err;
    }
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.owner_task_id)) {
        groups.set(r.owner_task_id, {
          ability_id: r.ability_id,
          ability_name: r.ability_name,
          ability_status: r.ability_status,
          owner_task_id: r.owner_task_id,
          steps: [],
        });
      }
      groups.get(r.owner_task_id).steps.push({
        id: r.id, order_no: r.order_no, feature_id: r.feature_id, note: r.note,
      });
    }
    res.json([...groups.values()]);
  } catch (err) {
    console.error('[abilities] GET /journeys/:journey_id/golden-paths error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/invariants?level=&target_type=&target_id=
//   干净的 invariant 读取端点：读 decisions 表（非 decision_log 审计表）。
//   替代坏的 GET /decisions?category=（status.js:270 读错表且忽略 category）。
router.get('/invariants', async (req, res) => {
  try {
    const { level, target_type, target_id } = req.query;
    if (level && !DECISION_LEVELS.includes(level))
      return res.status(400).json({ error: `level must be one of: ${DECISION_LEVELS.join(',')}` });
    const params = [];
    let sql = `SELECT * FROM decisions WHERE category='invariant' AND status='active'`;
    if (level)       { params.push(level);       sql += ` AND level=$${params.length}`; }
    if (target_type) { params.push(target_type); sql += ` AND target_type=$${params.length}`; }
    if (target_id)   { params.push(target_id);   sql += ` AND target_id=$${params.length}`; }
    sql += ` ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[abilities] GET /invariants error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- advancement_items (推进项账本) ----------

// GET /api/brain/abilities/:id/advancements — 列表 + 现算进度
router.get('/abilities/:id/advancements', async (req, res) => {
  try {
    const { id } = req.params;
    const ab = await pool.query(`SELECT id FROM journey_features WHERE id=$1`, [id]);
    if (ab.rows.length === 0) return res.status(404).json({ error: 'ability not found' });
    const items = await pool.query(
      `SELECT * FROM advancement_items WHERE ability_id=$1
       ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC`,
      [id]
    );
    const counts = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='done')  AS done,
              COUNT(*) FILTER (WHERE status='doing') AS doing,
              COUNT(*) FILTER (WHERE status='todo')  AS todo
       FROM advancement_items WHERE ability_id=$1`,
      [id]
    );
    const c = counts.rows[0];
    const progress = computeProgress({ done: +c.done, doing: +c.doing, todo: +c.todo });
    res.json({ ability_id: id, items: items.rows, progress });
  } catch (err) {
    console.error('[abilities] GET advancements error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/abilities/:id/advancements — 建推进项
router.post('/abilities/:id/advancements', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const ab = await pool.query(`SELECT id FROM journey_features WHERE id=$1`, [id]);
    if (ab.rows.length === 0) return res.status(404).json({ error: 'ability not found' });
    const { rows } = await pool.query(
      `INSERT INTO advancement_items (ability_id, title, priority)
       VALUES ($1,$2,$3) RETURNING *`,
      [id, title, priority || 'P1']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[abilities] POST advancements error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/advancements/:itemId — 改 status/pr_url/title/priority
router.patch('/advancements/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { status, pr_url, title, priority } = req.body;
    if (status && !ADVANCEMENT_STATUS.includes(status))
      return res.status(400).json({ error: `status must be one of: ${ADVANCEMENT_STATUS.join(',')}` });
    const sets = [];
    const params = [];
    if (status !== undefined) {
      params.push(status); sets.push(`status=$${params.length}`);
      sets.push(status === 'done' ? `done_at=now()` : `done_at=NULL`);
    }
    if (pr_url !== undefined)   { params.push(pr_url);   sets.push(`pr_url=$${params.length}`); }
    if (title !== undefined)    { params.push(title);    sets.push(`title=$${params.length}`); }
    if (priority !== undefined) { params.push(priority); sets.push(`priority=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'no updatable fields' });
    params.push(itemId);
    const { rows } = await pool.query(
      `UPDATE advancement_items SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'advancement item not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[abilities] PATCH advancement error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
