import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import { buildCascadeReport } from '../cascade-list.js';
import { classifyJourneyCellAssertion } from '../lib/journey-cell-assertion.js';

const router = Router();
router.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));

const VALID_JOURNEY_TYPES = ['user_facing', 'autonomous', 'dev_pipeline', 'agent_remote'];
const VALID_THICKNESS     = ['thin', 'medium', 'thick', 'mature'];
const VALID_PRIORITY      = ['P0', 'P1', 'P2', 'P3'];
const VALID_HOME          = ['biz', 'pre', 'xcut', 'factory'];
const VALID_SOFTNESS      = ['hard', 'soft'];
const VALID_CELL_STATUS   = ['gray', 'red', 'pending', 'green'];

// POST /api/brain/journeys
router.post('/journeys', async (req, res) => {
  try {
    const { name, journey_type, description, maturity, status, e2e_test_path, area, steps,
            home, trigger, endpoint } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!journey_type || !VALID_JOURNEY_TYPES.includes(journey_type)) {
      return res.status(400).json({ error: `journey_type must be one of: ${VALID_JOURNEY_TYPES.join(',')}` });
    }
    if (home && !VALID_HOME.includes(home)) {
      return res.status(400).json({ error: `home must be one of: ${VALID_HOME.join(',')}` });
    }

    // area name → area_id lookup
    let areaId = null;
    if (area) {
      const { rows } = await pool.query('SELECT id FROM areas WHERE name=$1 LIMIT 1', [area]);
      if (rows.length > 0) areaId = rows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO journeys
         (name, journey_type, description, maturity, status, e2e_test_path, area_id,
          home, trigger, endpoint, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL)
       RETURNING *`,
      [
        name,
        journey_type,
        description || null,
        maturity || 'not_started',
        status || 'active',
        e2e_test_path || null,
        areaId,
        home || null,
        trigger || null,
        endpoint || null,
      ]
    );
    const journey = rows[0];

    if (Array.isArray(steps) && steps.length > 0) {
      for (let i = 0; i < steps.length; i++) {
        await pool.query(
          `INSERT INTO journey_steps (journey_id, name, step_number, notion_synced_at)
           VALUES ($1,$2,$3,NULL) ON CONFLICT (journey_id, step_number) DO NOTHING`,
          [journey.id, steps[i], i + 1]
        );
      }
    }

    res.status(201).json(journey);
  } catch (err) {
    console.error('[journeys] POST /journeys error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journeys
router.get('/journeys', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const params = [];
    const clauses = [];
    if (req.query.area_id) { params.push(req.query.area_id); clauses.push(`area_id=$${params.length}`); }
    if (req.query.maturity) { params.push(req.query.maturity); clauses.push(`maturity=$${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT * FROM journeys ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[journeys] GET /journeys error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journeys/:id
router.get('/journeys/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM journeys WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] GET /journeys/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/journeys/:id — 承诺地图字段（mapper 落账用）
router.patch('/journeys/:id', async (req, res) => {
  try {
    const { home, domain, trigger, endpoint, description, maturity } = req.body;
    if (home && !VALID_HOME.includes(home)) {
      return res.status(400).json({ error: `home must be one of: ${VALID_HOME.join(',')}` });
    }
    const sets = [];
    const vals = [];
    let idx = 1;
    if (home !== undefined)        { sets.push(`home=$${idx++}`);        vals.push(home); }
    if (domain !== undefined)      { sets.push(`domain=$${idx++}`);      vals.push(domain); }
    if (trigger !== undefined)     { sets.push(`trigger=$${idx++}`);     vals.push(trigger); }
    if (endpoint !== undefined)    { sets.push(`endpoint=$${idx++}`);    vals.push(endpoint); }
    if (description !== undefined) { sets.push(`description=$${idx++}`); vals.push(description); }
    if (maturity !== undefined)    { sets.push(`maturity=$${idx++}`);    vals.push(maturity); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push(`updated_at=NOW()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE journeys SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] PATCH /journeys/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journey_features/unguarded-count — 裸奔 FR 数（guard_ref IS NULL AND status='live'）
router.get('/journey_features/unguarded-count', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM journey_features WHERE guard_ref IS NULL AND status = 'live'`
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    console.error('[journeys] GET /journey_features/unguarded-count error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journey_features/:id/blast-radius — 塌了哪些承诺红（MJ5 S1）
// 注：挂 journey_features 前缀而非 PRD 原文 /features/:id（后者已被 feature-ledger 表占用）
router.get('/journey_features/:id/blast-radius', async (req, res) => {
  try {
    const { rows: frows } = await pool.query(
      `SELECT id, name, status, "group" FROM journey_features WHERE id=$1`, [req.params.id]);
    if (!frows.length) return res.status(404).json({ error: 'feature not found' });
    const { rows } = await pool.query(
      `SELECT j.id AS journey_id, j.name AS journey_name, j.domain,
              s.id AS step_id, s.name AS step_name, s.step_number, s.promise, l.cell_status
       FROM journey_step_links l
       JOIN journey_steps s ON s.id = l.step_id
       JOIN journeys j ON j.id = s.journey_id
       WHERE l.feature_id = $1 AND l.cell_kind = 'base_ref'
       ORDER BY j.name, s.step_number`, [req.params.id]);
    res.json({ feature: frows[0], blast_radius: rows, count: rows.length });
  } catch (err) {
    console.error('[journeys] GET blast-radius error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journey_features
router.get('/journey_features', async (req, res) => {
  try {
    const { journey_id, kind, area, status, limit = 100 } = req.query;
    const params = [];
    const clauses = [];
    if (journey_id) { params.push(journey_id); clauses.push(`journey_id=$${params.length}`); }
    if (kind)       { params.push(kind);       clauses.push(`kind=$${params.length}`); }
    if (area)       { params.push(area);       clauses.push(`area_id=(SELECT id FROM areas WHERE name=$${params.length} LIMIT 1)`); }
    if (status)     { params.push(status);     clauses.push(`status=$${params.length}`); }
    params.push(parseInt(limit, 10) || 100);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM journey_features ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[journeys] GET /journey_features error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journey_features/:id — 单行精确取值(merge自动焊/apply器消费)
router.get('/journey_features/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM journey_features WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] GET /journey_features/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/journey_features
router.post('/journey_features', async (req, res) => {
  try {
    const { name, journey_id, thickness, status, area, unit_test_path, version, kind,
            workflow_ref, guard_ref, softness } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (status && status !== 'planned') {
      const hasAnchor = unit_test_path || workflow_ref || guard_ref;
      if (!hasAnchor) {
        return res.status(400).json({
          error: 'status 非 planned 时必须至少提供一个锚点字段(unit_test_path/workflow_ref/guard_ref)',
        });
      }
    }
    if (thickness && !VALID_THICKNESS.includes(thickness)) {
      return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
    }
    if (softness && !VALID_SOFTNESS.includes(softness)) {
      return res.status(400).json({ error: `softness must be one of: ${VALID_SOFTNESS.join(',')}` });
    }

    // journey_id lookup（resolves UUID or notion_id）
    let journeyUuid = null;
    if (journey_id) {
      const { rows: jr } = await pool.query(
        'SELECT id FROM journeys WHERE id::text=$1 OR notion_id=$1 LIMIT 1', [journey_id]
      );
      journeyUuid = jr.length ? jr[0].id : null;
    }

    // area name → area_id lookup
    let areaId = null;
    if (area) {
      const { rows: ar } = await pool.query('SELECT id FROM areas WHERE name=$1 LIMIT 1', [area]);
      if (ar.length) areaId = ar[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO journey_features
         (name, journey_id, thickness, status, area_id, unit_test_path, version, kind,
          workflow_ref, guard_ref, softness, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)
       RETURNING *`,
      [
        name,
        journeyUuid,
        thickness || 'thin',
        status || 'planned',
        areaId,
        unit_test_path || null,
        version || null,
        kind || 'feature',
        workflow_ref || null,
        guard_ref || null,
        softness || 'hard', // 349 起 softness NOT NULL DEFAULT 'hard'；显式传 NULL 会绕过 DEFAULT
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[journeys] POST /journey_features error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/journey_features/:id
router.patch('/journey_features/:id', async (req, res) => {
  try {
    const { thickness, status, unit_test_path, version, guard_ref, softness, group, workflow_ref } = req.body;
    if (thickness && !VALID_THICKNESS.includes(thickness)) {
      return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
    }
    if (softness && !VALID_SOFTNESS.includes(softness)) {
      return res.status(400).json({ error: `softness must be one of: ${VALID_SOFTNESS.join(',')}` });
    }

    const sets = [];
    const vals = [];
    let idx = 1;
    if (thickness)                      { sets.push(`thickness=$${idx++}`);      vals.push(thickness); }
    if (status)                         { sets.push(`status=$${idx++}`);          vals.push(status); }
    if (unit_test_path)                 { sets.push(`unit_test_path=$${idx++}`);  vals.push(unit_test_path); }
    if (version)                        { sets.push(`version=$${idx++}`);         vals.push(version); }
    if (guard_ref !== undefined)        { sets.push(`guard_ref=$${idx++}`);       vals.push(guard_ref ?? null); }
    if (workflow_ref !== undefined)     { sets.push(`workflow_ref=$${idx++}`);    vals.push(workflow_ref ?? null); }
    if (softness !== undefined)         { sets.push(`softness=$${idx++}`);        vals.push(softness ?? null); }
    if (group !== undefined)            { sets.push(`"group"=$${idx++}`);         vals.push(group ?? null); }
    if (!sets.length)                   return res.status(400).json({ error: 'no fields to update' });

    // thickness 变更 → 需重新推 Notion
    if (thickness) { sets.push(`notion_synced_at=NULL`); }
    sets.push(`updated_at=NOW()`);
    vals.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE journey_features SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] PATCH /journey_features/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/issues
router.post('/issues', async (req, res) => {
  try {
    const { title, priority, status, sub_area, body: bodyText, pr_url, journey_id } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (priority && !VALID_PRIORITY.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITY.join(',')}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO issues
         (title, priority, status, sub_area, body, pr_url, journey_id, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
       RETURNING *`,
      [
        title,
        priority || 'P2',
        status || 'In progress',
        sub_area || null,
        bodyText || null,
        pr_url || null,
        journey_id || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[journeys] POST /issues error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/issues — 列表（战斗室 Issues 面板 + line-strategist skill 消费；T6 88e0b448）
router.get('/issues', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const params = [];
    const clauses = [];
    if (req.query.status) {
      if (String(req.query.status).toLowerCase() === 'open') {
        // status=open 特判为"未关闭"：issues.status 是 Notion 风格词表（默认 'In progress'，
        // 库里实际有 In progress/open/Open/Closed/closed/Resolved），不存在统一的 'open' 精确值。
        // 消费方（line-strategist SKILL、IssuesPanel）用 open 表达"还没关的"，
        // 这里对齐 warroom.js 先例并大小写不敏感，涵盖 closed/resolved/done 语义。
        clauses.push(`LOWER(status) NOT IN ('closed','resolved','done')`);
      } else {
        params.push(req.query.status); clauses.push(`status=$${params.length}`);
      }
    }
    if (req.query.journey_id) { params.push(req.query.journey_id); clauses.push(`journey_id=$${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, title, priority, status, sub_area, journey_id, pr_url, created_at
       FROM issues ${where}
       ORDER BY priority ASC, created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ issues: rows });
  } catch (err) {
    console.error('[journeys] GET /issues error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/issues/:id — 更新 issue 状态/优先级（关闭 issue 等）
router.patch('/issues/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const PATCHABLE = ['status', 'priority', 'title', 'body', 'pr_url', 'sub_area'];
    const sets = [];
    const vals = [];
    for (const field of PATCHABLE) {
      if (req.body[field] !== undefined) {
        vals.push(req.body[field]);
        sets.push(`${field}=$${vals.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'no patchable fields provided' });
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE issues SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: 'issue not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] PATCH /issues/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journey_steps
router.get('/journey_steps', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const params = [];
    const clauses = [];
    if (req.query.journey_id) { params.push(req.query.journey_id); clauses.push(`journey_id=$${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT * FROM journey_steps ${where} ORDER BY journey_id, step_number LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[journeys] GET /journey_steps error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/journey_steps
router.post('/journey_steps', async (req, res) => {
  try {
    const { journey_id, name, step_number, description, status, promise, backbone_version } = req.body;
    if (!journey_id || !name || step_number === undefined) {
      return res.status(400).json({ error: 'journey_id, name, step_number are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO journey_steps (journey_id, name, step_number, description, status, promise, backbone_version, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'1.0'),NULL)
       ON CONFLICT (journey_id, step_number) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description,
         promise=COALESCE(EXCLUDED.promise, journey_steps.promise),
         backbone_version=COALESCE($7, journey_steps.backbone_version),
         updated_at=NOW()
       RETURNING *`,
      [journey_id, name, step_number, description || null, status || 'planned', promise || null, backbone_version || null]
    );
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('[journeys] POST /journey_steps error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journey_step_links
router.get('/journey_step_links', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const params = [];
    const clauses = [];
    if (req.query.journey_id) { params.push(req.query.journey_id); clauses.push(`journey_id=$${params.length}`); }
    if (req.query.cells === '1') {
      // 格子视图：只要格子行，可再叠加 cell_kind 精筛
      clauses.push(`cell_kind IS NOT NULL`);
      if (req.query.cell_kind) { params.push(req.query.cell_kind); clauses.push(`cell_kind=$${params.length}`); }
    } else {
      // 默认视图：排除格子行，保持 348 前的返回形状（防 119 个格子行混进老消费方）
      clauses.push(`cell_kind IS NULL`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT * FROM journey_step_links ${where} ORDER BY journey_id, step_order LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[journeys] GET /journey_step_links error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/journey_step_links —— legacy 连接行 + 格子行双通道
router.post('/journey_step_links', async (req, res) => {
  try {
    const {
      journey_id, step_id, step_order, status,
      cell_kind, cell_key, cell_status, feature_id, assertion_ref, na_reason,
    } = req.body;
    if (!journey_id || !step_id) {
      return res.status(400).json({ error: 'journey_id, step_id are required' });
    }

    if (cell_kind) {
      const VALID_CELL_KINDS = ['capability', 'element', 'scenario', 'base_ref'];
      const VALID_CELL_STATUS = ['gray', 'red', 'pending', 'green'];
      if (!VALID_CELL_KINDS.includes(cell_kind)) {
        return res.status(400).json({ error: `cell_kind must be one of: ${VALID_CELL_KINDS.join(',')}` });
      }
      if (!cell_key) return res.status(400).json({ error: 'cell_key is required when cell_kind is set' });
      if (cell_status && !VALID_CELL_STATUS.includes(cell_status)) {
        return res.status(400).json({ error: `cell_status must be one of: ${VALID_CELL_STATUS.join(',')}` });
      }
      // base_ref 格子是 blast-radius 的锚，没有 feature_id 的底座引用查不到塌红范围
      if (cell_kind === 'base_ref' && !feature_id) {
        return res.status(400).json({ error: 'feature_id is required for base_ref cells' });
      }

      // 一致性护栏：格子行的 step_id 必须真实存在，且其 journey_id 必须与传入的 journey_id 一致
      // （防止调用方传错 journey_id，格子挂到错误的 GP 下却无感知）
      const { rows: steprows } = await pool.query(
        `SELECT journey_id FROM journey_steps WHERE id=$1`, [step_id]
      );
      if (!steprows.length) return res.status(404).json({ error: 'step not found' });
      if (String(steprows[0].journey_id) !== String(journey_id)) {
        return res.status(400).json({ error: "journey_id does not match step's journey" });
      }

      const { rows } = await pool.query(
        `INSERT INTO journey_step_links
           (journey_id, step_id, cell_kind, cell_key, cell_status, feature_id, assertion_ref, na_reason, status, notion_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned',NOW())
         ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL DO UPDATE SET
           cell_status=EXCLUDED.cell_status, feature_id=EXCLUDED.feature_id,
           assertion_ref=EXCLUDED.assertion_ref, na_reason=EXCLUDED.na_reason
         RETURNING *`,
        [journey_id, step_id, cell_kind, cell_key, cell_status || 'gray',
         feature_id || null, assertion_ref || null, na_reason || null]
      );
      return res.status(201).json(rows[0]);
    }

    if (step_order === undefined) {
      return res.status(400).json({ error: 'step_order is required for non-cell links' });
    }
    const { rows } = await pool.query(
      `INSERT INTO journey_step_links (journey_id, step_id, step_order, status, notion_synced_at)
       VALUES ($1,$2,$3,$4,NULL)
       ON CONFLICT (journey_id, step_id) WHERE cell_kind IS NULL DO UPDATE SET
         step_order=EXCLUDED.step_order, status=EXCLUDED.status
       RETURNING *`,
      [journey_id, step_id, step_order, status || 'planned']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[journeys] POST /journey_step_links error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/journey_step_links/:id — 格子状态回写（evaluator S3联动 + S4保鲜用）
// fail-closed: cell_status='green' 时必须有 assertion_ref（现有行或本次请求）
// 决策 df1ccf5a §③：机器托管，军师只提案不点绿；无 assertion_ref 拒收
router.patch('/journey_step_links/:id', async (req, res) => {
  try {
    const { cell_status, assertion_ref, na_reason, cell_kind } = req.body;
    if (cell_status && !VALID_CELL_STATUS.includes(cell_status)) {
      return res.status(400).json({ error: `cell_status must be one of: ${VALID_CELL_STATUS.join(',')}` });
    }

    if (cell_status === 'green' && !assertion_ref) {
      const { rows: existing } = await pool.query(
        'SELECT assertion_ref FROM journey_step_links WHERE id=$1',
        [req.params.id]
      );
      if (!existing.length) return res.status(404).json({ error: 'not found' });
      if (!existing[0].assertion_ref) {
        return res.status(422).json({
          error: 'fail-closed: green requires assertion_ref (decision df1ccf5a §③)',
        });
      }
    }

    const sets = [];
    const vals = [];
    let idx = 1;
    if (cell_status)              { sets.push(`cell_status=$${idx++}`);    vals.push(cell_status); }
    if (assertion_ref !== undefined) { sets.push(`assertion_ref=$${idx++}`); vals.push(assertion_ref ?? null); }
    if (na_reason !== undefined)  { sets.push(`na_reason=$${idx++}`);      vals.push(na_reason ?? null); }
    if (cell_kind !== undefined)  { sets.push(`cell_kind=$${idx++}`);      vals.push(cell_kind ?? null); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE journey_step_links SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[journeys] PATCH /journey_step_links/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journeys/steps/:step_id/impact — S3 联动清单（thin档）
// evaluator 通过 anchor.step_id 查该步骤全部格子+断言锚点，生成联动清单
router.get('/journeys/steps/:step_id/impact', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         jsl.id           AS link_id,
         jsl.feature_id,
         jf.name          AS feature_name,
         jf.kind          AS feature_kind,
         jsl.cell_kind,
         jsl.cell_status,
         jsl.assertion_ref,
         jsl.na_reason
       FROM journey_step_links jsl
       LEFT JOIN journey_features jf ON jf.id = jsl.feature_id
       WHERE jsl.step_id = $1
       ORDER BY jsl.step_order, jsl.id`,
      [req.params.step_id]
    );
    const impacts = rows.map(r => ({
      ...r,
      ...classifyJourneyCellAssertion(r),
    }));
    const runnable_count = impacts.filter(r => r.runnable).length;
    res.json({
      step_id: req.params.step_id,
      total: impacts.length,
      runnable_count,
      impacts,
    });
  } catch (err) {
    console.error('[journeys] GET /journeys/steps/:step_id/impact error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/journey_steps/:step_id/ledger
// 产品 Golden Path 每步四区账本：journey_step_links 是唯一格子 SSOT。
router.get('/journey_steps/:step_id/ledger', async (req, res) => {
  try {
    const stepId = req.params.step_id;

    const { rows: stepRows } = await pool.query(
      `SELECT
         js.id,
         js.name,
         js.step_number,
         js.promise,
         js.journey_id,
         j.name AS journey_name,
         j.home,
         j.domain
       FROM journey_steps js
       JOIN journeys j ON j.id = js.journey_id
       WHERE js.id=$1`,
      [stepId]
    );
    if (!stepRows.length) return res.status(404).json({ error: 'step not found' });

    const { rows: cellRows } = await pool.query(
      `SELECT
         jsl.id AS link_id,
         jsl.cell_kind,
         jsl.cell_key,
         jsl.cell_status,
         COALESCE(
           jsl.assertion_ref,
           jf.unit_test_path,
           jf.workflow_ref,
           jf.guard_ref
         ) AS assertion_ref,
         jsl.na_reason,
         jsl.feature_id,
         jf.name AS feature_name,
         jf.unit_test_path,
         jf.workflow_ref,
         jf.guard_ref
       FROM journey_step_links jsl
       LEFT JOIN journey_features jf ON jf.id = jsl.feature_id
       WHERE jsl.step_id = $1
         AND jsl.cell_kind IS NOT NULL
       ORDER BY
         CASE jsl.cell_kind
           WHEN 'capability' THEN 1
           WHEN 'element' THEN 2
           WHEN 'scenario' THEN 3
           WHEN 'base_ref' THEN 4
           ELSE 5
         END,
         jsl.id`,
      [stepId]
    );

    const { rows: nfrRows } = await pool.query(
      `SELECT id, topic, decision, source_ref
       FROM decisions
       WHERE category='nfr'
         AND level='step'
         AND target_type='journey_step'
         AND target_id=$1
         AND status='active'
       ORDER BY created_at, id`,
      [stepId]
    );

    const cells = cellRows.map(row => ({
      ...row,
      ...classifyJourneyCellAssertion(row),
    }));
    const zones = {
      capability: [],
      element: [],
      scenario: [],
      base_ref: [],
    };
    for (const cell of cells) {
      if (zones[cell.cell_kind]) zones[cell.cell_kind].push(cell);
    }

    const missing = cells.filter(cell => cell.needs_assertion).length;
    const positiveMissing = cells.filter(cell =>
      cell.needs_assertion && ['green', 'pending'].includes(cell.cell_status)
    ).length;
    const hasNfrCell = cells.some(cell =>
      cell.cell_kind === 'element' && cell.cell_key === 'NFR'
    );
    const readiness = {
      total: cells.length,
      runnable: cells.filter(cell => cell.runnable).length,
      semantic: cells.filter(cell =>
        ['evaluation', 'decision'].includes(cell.assertion_state)
      ).length,
      not_applicable: cells.filter(cell =>
        cell.assertion_state === 'not_applicable'
      ).length,
      missing,
      positive_missing: positiveMissing,
      ready: positiveMissing === 0 && (!hasNfrCell || nfrRows.length > 0),
    };

    res.json({
      step: stepRows[0],
      zones,
      nfr_decisions: nfrRows,
      readiness,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[journeys] GET /journey_steps/:step_id/ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/features/:id/blast-radius
// 返回"该件塌了哪些承诺红"：通过 journey_step_links 反查所有引用本件的步骤+承诺
router.get('/features/:id/blast-radius', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         jsl.id          AS link_id,
         jsl.cell_kind,
         jsl.cell_status,
         jsl.assertion_ref,
         js.id           AS step_id,
         js.name         AS step_name,
         js.promise,
         js.step_number,
         j.id            AS journey_id,
         j.name          AS journey_name,
         j.home
       FROM journey_step_links jsl
       JOIN journey_steps js ON js.id = jsl.step_id
       JOIN journeys j       ON j.id  = js.journey_id
       WHERE jsl.feature_id = $1
       ORDER BY j.name, js.step_number`,
      [req.params.id]
    );
    const feature = await pool.query(
      'SELECT id, name, kind, softness, thickness FROM journey_features WHERE id=$1',
      [req.params.id]
    );
    if (!feature.rows.length) return res.status(404).json({ error: 'feature not found' });
    res.json({
      feature: feature.rows[0],
      blast_radius: rows,
      affected_journeys: [...new Set(rows.map(r => r.journey_name))],
    });
  } catch (err) {
    console.error('[journeys] GET /features/:id/blast-radius error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/cascade-list — S3 联动清单（thin档）
// 输入：changed_files[]（PR 改动文件路径）
// 输出：被影响的格子断言列表 + 分类摘要（可跑/待 nightly/未登记）
router.post('/cascade-list', async (req, res) => {
  try {
    const { changed_files } = req.body;
    if (!Array.isArray(changed_files) || changed_files.length === 0) {
      return res.status(400).json({ error: 'changed_files 数组必填' });
    }

    // 1. 找到被改动文件涉及的格子（journey_step_links）
    // 匹配策略（thin档）：
    //   a) 格子 assertion_ref 与 changed_files 直接匹配
    //   b) 所属 journey_features.unit_test_path 与 changed_files 匹配
    const { rows: cells } = await pool.query(
      `SELECT
         jsl.id           AS link_id,
         jsl.feature_id,
         jsl.cell_kind,
         jsl.cell_status,
         jsl.assertion_ref,
         jsl.na_reason,
         jf.name          AS feature_name,
         jf.unit_test_path,
         js.id            AS step_id,
         js.name          AS step_name,
         js.promise,
         js.step_number,
         j.id             AS journey_id,
         j.name           AS journey_name
       FROM journey_step_links jsl
       LEFT JOIN journey_features jf ON jf.id = jsl.feature_id
       LEFT JOIN journey_steps    js ON js.id  = jsl.step_id
       LEFT JOIN journeys          j ON j.id   = js.journey_id
       WHERE
         (jsl.assertion_ref = ANY($1::text[]))
         OR (jf.unit_test_path = ANY($1::text[]))
       ORDER BY j.name, js.step_number`,
      [changed_files]
    );

    const report = buildCascadeReport(cells);

    res.json({
      changed_files_count: changed_files.length,
      ...report,
      cells,
    });
  } catch (err) {
    console.error('[journeys] POST /cascade-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brain/ledger — 11要素账本（journey_features 视图，单次查询）
// 可选参数: ?journey_id=xxx 过滤到单个 journey；?limit=N（默认200，最大1000）
router.get('/ledger', async (req, res) => {
  try {
    const journeyId = req.query.journey_id || null;
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

    // 1. 拉取 journey_features，JOIN journeys 取 e2e_test_path 和 journey 名
    const { rows: features } = journeyId
      ? await pool.query(
          `SELECT jf.*, j.name AS journey_name, j.e2e_test_path
             FROM journey_features jf
             LEFT JOIN journeys j ON j.id = jf.journey_id
            WHERE jf.journey_id = $1
            ORDER BY jf.created_at DESC
            LIMIT $2`,
          [journeyId, limit]
        )
      : await pool.query(
          `SELECT jf.*, j.name AS journey_name, j.e2e_test_path
             FROM journey_features jf
             LEFT JOIN journeys j ON j.id = jf.journey_id
            WHERE jf.name NOT LIKE 'gp-agg-smoke%'
            ORDER BY jf.created_at DESC
            LIMIT $1`,
          [limit]
        );

    // 2. 拉取相关 decisions（NFR/invariant/gate）
    const allIds = [...new Set(
      features.flatMap(f => [f.id, f.journey_id].filter(Boolean))
    )];
    const { rows: decisions } = allIds.length
      ? await pool.query(
          `SELECT id, category, topic, status, target_id, target_type
             FROM decisions
            WHERE status = 'active'
              AND target_id = ANY($1)`,
          [allIds]
        )
      : { rows: [] };

    // 按 target_id 聚合
    const nfrMap = {};
    const invMap = {};
    const gateMap = {};
    for (const d of decisions) {
      if (d.category === 'nfr') {
        nfrMap[d.target_id] = (nfrMap[d.target_id] || 0) + 1;
      }
      if (d.category === 'invariant' || (d.topic && d.topic.includes('不变量'))) {
        invMap[d.target_id] = (invMap[d.target_id] || 0) + 1;
      }
      if (d.category === 'gate' || (d.topic && (d.topic.includes('判定') || d.topic.includes('验收')))) {
        gateMap[d.target_id] = (gateMap[d.target_id] || 0) + 1;
      }
    }

    // 3. 计算每条 feature 的 11 要素覆盖
    const STALE_DAYS = 30;
    const now = Date.now();
    const rows = features.map(f => {
      const days = Math.floor((now - new Date(f.updated_at).getTime()) / 86400000);
      const nfrCnt = (nfrMap[f.id] || 0) + (nfrMap[f.journey_id] || 0);
      const invCnt = (invMap[f.id] || 0) + (invMap[f.journey_id] || 0);
      const gateCnt = (gateMap[f.id] || 0) + (gateMap[f.journey_id] || 0);

      const coverage = {
        fr:          (f.name && f.name.length > 5) ? 'present' : 'missing',
        nfr:         nfrCnt > 0 ? 'present' : 'unknown',
        invariant:   invCnt > 0 ? 'present' : 'unknown',
        gate:        gateCnt > 0 ? 'present' : 'unknown',
        ttl:         f.unit_test_path ? 'present' : 'missing',
        death:       f.guard_ref ? 'present' : 'missing',
        failure:     (f.unit_test_path || f.guard_ref) ? 'present' : 'missing',
        e2e:         f.e2e_test_path ? 'present' : 'missing',
        adversarial: 'unknown',
        freshness:   days > STALE_DAYS ? 'stale' : 'present',
        twoaxis:     f.area_id ? 'present' : 'unknown',
      };
      const coverage_score = Object.values(coverage).filter(v => v === 'present').length;

      return {
        id: f.id,
        name: f.name,
        journey_id: f.journey_id,
        journey_name: f.journey_name || null,
        status: f.status,
        kind: f.kind,
        thickness: f.thickness,
        area_id: f.area_id,
        unit_test_path: f.unit_test_path,
        guard_ref: f.guard_ref,
        workflow_ref: f.workflow_ref,
        updated_at: f.updated_at,
        created_at: f.created_at,
        coverage,
        coverage_score,
      };
    });

    res.json({
      rows,
      meta: { total: rows.length, journey_id: journeyId },
    });
  } catch (err) {
    console.error('[journeys] GET /ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
