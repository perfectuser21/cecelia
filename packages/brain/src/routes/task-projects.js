/**
 * Task Projects route (migrated from apps/api/src/task-system/projects.js)
 *
 * GET / — 列出所有项目（支持 workspace_id, area_id, status, parent_id, top_level 过滤）
 *
 * Only the GET list endpoint is needed by the frontend (LiveMonitorPage).
 * Full CRUD remains in apps/api for future migration if needed.
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /projects
router.get('/', async (req, res) => {
  try {
    const { workspace_id, area_id, status, parent_id, top_level } = req.query;

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (workspace_id) {
      conditions.push(`workspace_id = $${paramIndex++}`);
      params.push(workspace_id);
    }
    if (area_id) {
      conditions.push(`area_id = $${paramIndex++}`);
      params.push(area_id);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }
    if (parent_id) {
      conditions.push(`parent_id = $${paramIndex++}`);
      params.push(parent_id);
    } else if (top_level === 'true') {
      conditions.push('parent_id IS NULL');
    }

    let query = 'SELECT * FROM projects';
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list projects', details: err.message });
  }
});

export default router;
