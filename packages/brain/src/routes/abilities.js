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

// ---------- 件7：map↔画布对齐（map=SSOT，决策 e66cf847）----------

const RUN_RESULT_VERDICTS = ['completed', 'failed'];

// GET /api/brain/golden_path/canvas?owner_task_id=...
//   只读画布生成器：golden_path（L4 step，order_no）→ n8n V4 骨架 stages JSON。
//   V4 黄金格式 {id, skill, label, objective, index, max_attempts}（源自 AwrSocialLeadgenV4 冻结合同节点），
//   扩展 step_id/feature_id/order_no/maturity/last_run——stage 必须显式携带 step_id，
//   回写按 step_id 对号入座（name 会改、order_no 会插队）。
//   index 用数组位置（连续 1..N），V4 画布按 ctx.stages[i] 下标取格；order_no 保留原值。
//   不写 n8n：画布热更由调用方走 n8n 公共 REST（deactivate/activate），禁 import:workflow（掉 webhook）。
router.get('/golden_path/canvas', async (req, res) => {
  try {
    const { owner_task_id } = req.query;
    if (!owner_task_id)
      return res.status(400).json({ error: 'owner_task_id is required' });
    let taskRows;
    try {
      ({ rows: taskRows } = await pool.query(
        'SELECT id, title FROM tasks WHERE id=$1', [owner_task_id]
      ));
    } catch (err) {
      if (err.code === '22P02')
        return res.status(400).json({ error: `invalid owner_task_id: ${owner_task_id}` });
      throw err;
    }
    if (!taskRows.length)
      return res.status(404).json({ error: `owner_task_id not found in tasks: ${owner_task_id}` });
    const { rows } = await pool.query(
      `SELECT gp.id, gp.order_no, gp.note,
              jf.id AS feature_id, jf.name AS feature_name, jf.workflow_ref,
              jf.thickness, jf.status AS feature_status,
              r.run_id AS last_run_id, r.verdict AS last_verdict, r.created_at AS last_run_at
       FROM golden_path gp
       LEFT JOIN journey_features jf ON jf.id = gp.feature_id
       LEFT JOIN LATERAL (
         SELECT run_id, verdict, created_at
         FROM golden_path_run_receipts
         WHERE golden_path_id = gp.id
         ORDER BY created_at DESC LIMIT 1
       ) r ON true
       WHERE gp.owner_task_id = $1
       ORDER BY gp.order_no ASC`,
      [owner_task_id]
    );
    if (!rows.length)
      return res.status(404).json({ error: `no golden_path steps for owner_task_id: ${owner_task_id}` });
    const stages = rows.map((row, i) => ({
      id: `step-${i + 1}`,
      index: i + 1,
      order_no: row.order_no,
      step_id: row.id,
      feature_id: row.feature_id,
      skill: row.workflow_ref || null,
      label: row.feature_name || row.note || `step-${i + 1}`,
      objective: row.note || '',
      max_attempts: 2,
      maturity: row.thickness || null,
      feature_status: row.feature_status || null,
      last_run: row.last_run_id
        ? { run_id: row.last_run_id, verdict: row.last_verdict, at: row.last_run_at }
        : null,
    }));
    res.json({
      source: 'golden_path',
      schema_version: 1,
      owner_task_id,
      canvas_name: taskRows[0].title,
      total_steps: stages.length,
      stages,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[abilities] GET /golden_path/canvas error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/golden_path/:id/run-result — run 终态回写 step 成熟度
//   verdict 封闭词表 completed|failed；幂等键 (golden_path_id, run_id)（重放返回 200 idempotent）。
//   成熟度单级推进：completed 且 feature.status='planned' → 'working'，其余一律不动
//   （加厚靠真实反馈、禁跳级；done 需要更强验收证据，不在本端点自动打）。
//   UPDATE 带 status='planned' 谓词：并发重放/人工改状态时绝不回退或跳级。
router.post('/golden_path/:id/run-result', async (req, res) => {
  try {
    const { run_id, verdict, evidence } = req.body || {};
    if (!run_id) return res.status(400).json({ error: 'run_id is required' });
    if (!RUN_RESULT_VERDICTS.includes(verdict))
      return res.status(400).json({ error: `verdict must be one of: ${RUN_RESULT_VERDICTS.join('|')}` });
    let stepRows;
    try {
      ({ rows: stepRows } = await pool.query(
        `SELECT gp.id, gp.feature_id, jf.status AS feature_status
         FROM golden_path gp
         LEFT JOIN journey_features jf ON jf.id = gp.feature_id
         WHERE gp.id=$1`, [req.params.id]
      ));
    } catch (err) {
      if (err.code === '22P02')
        return res.status(400).json({ error: `invalid golden_path id: ${req.params.id}` });
      throw err;
    }
    if (!stepRows.length)
      return res.status(404).json({ error: `golden_path step not found: ${req.params.id}` });
    const step = stepRows[0];
    const { rows: receiptRows } = await pool.query(
      `INSERT INTO golden_path_run_receipts (golden_path_id, run_id, verdict, evidence)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (golden_path_id, run_id) DO NOTHING
       RETURNING id`,
      [step.id, run_id, verdict, JSON.stringify(evidence || {})]
    );
    if (!receiptRows.length) {
      // 同 (step, run) 重放：幂等返回，不重复写、不二次推进
      return res.json({ idempotent: true, golden_path_id: step.id, run_id });
    }
    let featurePromotion = null;
    if (verdict === 'completed' && step.feature_id && step.feature_status === 'planned') {
      const { rows: promoted } = await pool.query(
        `UPDATE journey_features SET status='working', updated_at=now()
         WHERE id=$1 AND status='planned' RETURNING id, status`,
        [step.feature_id]
      );
      if (promoted.length)
        featurePromotion = { feature_id: step.feature_id, from: 'planned', to: 'working' };
    }
    res.status(201).json({
      receipt_id: receiptRows[0].id,
      golden_path_id: step.id,
      run_id,
      verdict,
      feature_promotion: featurePromotion,
    });
  } catch (err) {
    console.error('[abilities] POST /golden_path/:id/run-result error:', err.message);
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
//   键：golden_path.feature_id → journey_features（T2 对齐，与 harness-line-context.js 同源）。
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
      JOIN journey_features jf ON gp.feature_id = jf.id
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
    const ab = await pool.query(`SELECT id FROM journey_features WHERE id=$1 AND kind='ability'`, [id]);
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
    const ab = await pool.query(`SELECT id FROM journey_features WHERE id=$1 AND kind='ability'`, [id]);
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
