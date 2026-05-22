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

// POST /api/brain/journey_features
router.post('/journey_features', async (req, res) => {
  try {
    const { name, journey_id, thickness, status, area, unit_test_path, version } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (thickness && !VALID_THICKNESS.includes(thickness)) {
      return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
    }

    // journey_id lookup（resolves UUID or notion_id）
    let journeyUuid = null;
    if (journey_id) {
      const { rows: jr } = await pool.query(
        'SELECT id FROM journeys WHERE id=$1 OR notion_id=$1 LIMIT 1', [journey_id]
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
         (name, journey_id, thickness, status, area_id, unit_test_path, version, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
       RETURNING *`,
      [
        name,
        journeyUuid,
        thickness || 'thin',
        status || 'planned',
        areaId,
        unit_test_path || null,
        version || null,
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
    const { thickness, status, unit_test_path, version } = req.body;
    if (thickness && !VALID_THICKNESS.includes(thickness)) {
      return res.status(400).json({ error: `thickness must be one of: ${VALID_THICKNESS.join(',')}` });
    }

    const sets = [];
    const vals = [];
    let idx = 1;
    if (thickness)      { sets.push(`thickness=$${idx++}`);      vals.push(thickness); }
    if (status)         { sets.push(`status=$${idx++}`);          vals.push(status); }
    if (unit_test_path) { sets.push(`unit_test_path=$${idx++}`);  vals.push(unit_test_path); }
    if (version)        { sets.push(`version=$${idx++}`);         vals.push(version); }
    if (!sets.length)   return res.status(400).json({ error: 'no fields to update' });

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
    const { title, priority, status, sub_area, body: bodyText, pr_url } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (priority && !VALID_PRIORITY.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITY.join(',')}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO issues
         (title, priority, status, sub_area, body, pr_url, notion_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,NULL)
       RETURNING *`,
      [
        title,
        priority || 'P2',
        status || 'In progress',
        sub_area || null,
        bodyText || null,
        pr_url || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[journeys] POST /issues error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
