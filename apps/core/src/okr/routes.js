/**
 * OKR API - Single-layer Area OKR architecture
 * Each Area has Objectives, each Objective has Key Results
 * Projects contribute to Key Results (execution layer)
 */

import { Router } from 'express';
import pool from '../task-system/db.js';

const router = Router();

/**
 * GET /api/okr/areas
 * Get all Areas with OKR statistics
 */
router.get('/areas', async (req, res) => {
  try {
    const { quarter } = req.query;

    // Get all businesses (Areas)
    let businessQuery = 'SELECT id, name, created_at FROM businesses ORDER BY created_at ASC';
    const businesses = await pool.query(businessQuery);

    // For each business, get OKR statistics
    const areasWithStats = await Promise.all(
      businesses.rows.map(async (business) => {
        // Get objectives count for this Area
        let objQuery = `
          SELECT COUNT(*) as objectives_count
          FROM goals
          WHERE business_id = $1
        `;
        const params = [business.id];

        if (quarter) {
          objQuery += ' AND quarter = $2';
          params.push(quarter);
        }

        const objResult = await pool.query(objQuery, params);

        // Get average progress from all KRs
        let progressQuery = `
          SELECT AVG(kr.current_value::numeric / NULLIF(kr.target_value::numeric, 0) * 100) as avg_progress
          FROM key_results kr
          JOIN goals g ON kr.goal_id = g.id
          WHERE g.business_id = $1
        `;
        const progressParams = [business.id];

        if (quarter) {
          progressQuery += ' AND g.quarter = $2';
          progressParams.push(quarter);
        }

        const progressResult = await pool.query(progressQuery, progressParams);

        return {
          id: business.id,
          name: business.name,
          objectives_count: parseInt(objResult.rows[0].objectives_count) || 0,
          avg_progress: Math.round(parseFloat(progressResult.rows[0].avg_progress) || 0),
        };
      })
    );

    res.json(areasWithStats);
  } catch (err) {
    console.error('Error fetching areas:', err);
    res.status(500).json({ error: 'Failed to fetch areas', details: err.message });
  }
});

/**
 * GET /api/okr/areas/:areaId
 * Get complete OKR for a specific Area (all Objectives + Key Results)
 */
router.get('/areas/:areaId', async (req, res) => {
  try {
    const { areaId } = req.params;
    const { quarter } = req.query;

    // Get Area info
    const businessResult = await pool.query('SELECT * FROM businesses WHERE id = $1', [areaId]);
    if (businessResult.rows.length === 0) {
      return res.status(404).json({ error: 'Area not found' });
    }
    const area = businessResult.rows[0];

    // Get all Objectives for this Area
    let objQuery = `
      SELECT * FROM goals
      WHERE business_id = $1
    `;
    const params = [areaId];

    if (quarter) {
      objQuery += ' AND quarter = $2';
      params.push(quarter);
    }

    objQuery += ' ORDER BY created_at ASC';

    const objResult = await pool.query(objQuery, params);

    // For each Objective, get its Key Results
    const objectives = await Promise.all(
      objResult.rows.map(async (obj) => {
        const krResult = await pool.query(
          `SELECT * FROM key_results WHERE goal_id = $1 ORDER BY created_at ASC`,
          [obj.id]
        );

        // For each KR, get contributing Projects
        const keyResults = await Promise.all(
          krResult.rows.map(async (kr) => {
            const projectsResult = await pool.query(
              `SELECT id, name FROM projects WHERE contributes_to_kr_id = $1`,
              [kr.id]
            );

            return {
              ...kr,
              projects: projectsResult.rows,
            };
          })
        );

        return {
          ...obj,
          key_results: keyResults,
        };
      })
    );

    res.json({
      area,
      objectives,
    });
  } catch (err) {
    console.error('Error fetching area OKR:', err);
    res.status(500).json({ error: 'Failed to fetch area OKR', details: err.message });
  }
});

/**
 * GET /api/okr/objectives/:id
 * Get a single Objective with all its Key Results
 */
router.get('/objectives/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get Objective
    const objResult = await pool.query('SELECT * FROM goals WHERE id = $1', [id]);
    if (objResult.rows.length === 0) {
      return res.status(404).json({ error: 'Objective not found' });
    }

    // Get Key Results
    const krResult = await pool.query(
      `SELECT * FROM key_results WHERE goal_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    // For each KR, get contributing Projects
    const keyResults = await Promise.all(
      krResult.rows.map(async (kr) => {
        const projectsResult = await pool.query(
          `SELECT id, name FROM projects WHERE contributes_to_kr_id = $1`,
          [kr.id]
        );

        return {
          ...kr,
          projects: projectsResult.rows,
        };
      })
    );

    res.json({
      ...objResult.rows[0],
      key_results: keyResults,
    });
  } catch (err) {
    console.error('Error fetching objective:', err);
    res.status(500).json({ error: 'Failed to fetch objective', details: err.message });
  }
});

/**
 * GET /api/okr/key-results/:id
 * Get a single Key Result with contributing Projects
 */
router.get('/key-results/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get Key Result
    const krResult = await pool.query('SELECT * FROM key_results WHERE id = $1', [id]);
    if (krResult.rows.length === 0) {
      return res.status(404).json({ error: 'Key Result not found' });
    }

    // Get contributing Projects
    const projectsResult = await pool.query(
      `SELECT id, name FROM projects WHERE contributes_to_kr_id = $1`,
      [id]
    );

    res.json({
      ...krResult.rows[0],
      projects: projectsResult.rows,
    });
  } catch (err) {
    console.error('Error fetching key result:', err);
    res.status(500).json({ error: 'Failed to fetch key result', details: err.message });
  }
});

/**
 * POST /api/okr/objectives
 * Create a new Objective
 */
router.post('/objectives', async (req, res) => {
  try {
    const { business_id, title, description, quarter, status, priority } = req.body;

    if (!business_id || !title) {
      return res.status(400).json({ error: 'business_id and title are required' });
    }

    const result = await pool.query(
      `INSERT INTO goals (business_id, title, description, quarter, status, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [business_id, title, description || null, quarter || null, status || 'pending', priority || 'P2']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating objective:', err);
    res.status(500).json({ error: 'Failed to create objective', details: err.message });
  }
});

/**
 * POST /api/okr/key-results
 * Create a new Key Result
 */
router.post('/key-results', async (req, res) => {
  try {
    const {
      goal_id,
      title,
      description,
      target_value,
      current_value,
      unit,
      status,
      priority,
      expected_completion_date,
    } = req.body;

    if (!goal_id || !title || target_value == null) {
      return res.status(400).json({ error: 'goal_id, title, and target_value are required' });
    }

    const result = await pool.query(
      `INSERT INTO key_results
       (goal_id, title, description, target_value, current_value, unit, status, priority, expected_completion_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        goal_id,
        title,
        description || null,
        target_value,
        current_value || 0,
        unit || null,
        status || 'on_track',
        priority || 'P2',
        expected_completion_date || null,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating key result:', err);
    res.status(500).json({ error: 'Failed to create key result', details: err.message });
  }
});

/**
 * PATCH /api/okr/key-results/:id
 * Update a Key Result
 */
router.patch('/key-results/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      target_value,
      current_value,
      unit,
      status,
      priority,
      expected_completion_date,
    } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (target_value !== undefined) {
      updates.push(`target_value = $${paramCount++}`);
      values.push(target_value);
    }
    if (current_value !== undefined) {
      updates.push(`current_value = $${paramCount++}`);
      values.push(current_value);
    }
    if (unit !== undefined) {
      updates.push(`unit = $${paramCount++}`);
      values.push(unit);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramCount++}`);
      values.push(priority);
    }
    if (expected_completion_date !== undefined) {
      updates.push(`expected_completion_date = $${paramCount++}`);
      values.push(expected_completion_date);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE key_results
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Key Result not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating key result:', err);
    res.status(500).json({ error: 'Failed to update key result', details: err.message });
  }
});

export default router;
