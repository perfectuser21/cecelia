import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_JOURNEY_TYPES = ['user_facing', 'autonomous', 'dev_pipeline', 'agent_remote'];
const VALID_THICKNESS     = ['thin', 'medium', 'thick', 'mature'];
const VALID_PRIORITY      = ['P0', 'P1', 'P2', 'P3'];

// POST /api/brain/journeys
router.post('/journeys', async (req, res) => {
  try {
    const { name, journey_type, description, maturity, status, e2e_test_path, area, steps } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!journey_type || !VALID_JOURNEY_TYPES.includes(journey_type)) {
      return res.status(400).json({ error: `journey_type must be one of: ${VALID_JOURNEY_TYPES.join(',')}` });
    }

    // area name → area_id lookup
    let areaId = null;
    if (area) {
      const { rows } = await pool.query('SELECT id FROM areas WHERE name=$1 LIMIT 1', [area]);
      if (rows.length > 0) areaId = rows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO journeys
         (name, journey_type, description, maturity, status, e2e_test_path, area_id, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
       RETURNING *`,
      [
        name,
        journey_type,
        description || null,
        maturity || 'not_started',
        status || 'active',
        e2e_test_path || null,
        areaId,
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

// POST /api/brain/journey_features
router.post('/journey_features', async (req, res) => {
  try {
    const { name, journey_id, thickness, status, area, unit_test_path, version, kind, workflow_ref, guard_ref } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (thickness && !VALID_THICKNESS.includes(thickness)) {
      return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
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
         (name, journey_id, thickness, status, area_id, unit_test_path, version, kind, workflow_ref, guard_ref, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL)
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
    const { thickness, status, unit_test_path, version, guard_ref } = req.body;
    if (thickness && !VALID_THICKNESS.includes(thickness)) {
      return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
    }

    const sets = [];
    const vals = [];
    let idx = 1;
    if (thickness)                      { sets.push(`thickness=$${idx++}`);      vals.push(thickness); }
    if (status)                         { sets.push(`status=$${idx++}`);          vals.push(status); }
    if (unit_test_path)                 { sets.push(`unit_test_path=$${idx++}`);  vals.push(unit_test_path); }
    if (version)                        { sets.push(`version=$${idx++}`);         vals.push(version); }
    if (guard_ref !== undefined)        { sets.push(`guard_ref=$${idx++}`);       vals.push(guard_ref ?? null); }
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
    const { journey_id, name, step_number, description, status } = req.body;
    if (!journey_id || !name || step_number === undefined) {
      return res.status(400).json({ error: 'journey_id, name, step_number are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO journey_steps (journey_id, name, step_number, description, status, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,NULL)
       ON CONFLICT (journey_id, step_number) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description, updated_at=NOW()
       RETURNING *`,
      [journey_id, name, step_number, description || null, status || 'planned']
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

export default router;
