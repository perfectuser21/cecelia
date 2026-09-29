import { Router } from 'express';
import pool from '../db.js';

const router = Router();
const VALID_STATUSES = ['active', 'deprecated', 'planned'];

// GET /api/brain/skills
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const params = [];
    const clauses = [];

    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      params.push(req.query.status);
      clauses.push(`status = $${params.length}`);
    }
    const search = req.query.search || req.query.q;
    if (search) {
      const qv = `%${search}%`;
      params.push(qv, qv);
      clauses.push(`(name ILIKE $${params.length - 1} OR description ILIKE $${params.length})`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT id, notion_id, name, description, location, status, area_id, metadata, notion_synced_at, created_at, updated_at
       FROM skill_registry
       ${where}
       ORDER BY name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error('[skills] GET error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/brain/skills
router.post('/', async (req, res) => {
  try {
    const { name, description, location, status, metadata = {}, area_id, notion_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    // 冲突不再整行覆盖（Skill 台账投影 PR1a）：没传的保留原值，status 只在显式传入时覆盖，
    // metadata 合并且剔除推送指纹——整块覆盖曾冲掉 pushed_digest/eval_score、清空 notion_id 致重复建页。
    const meta = {};
    if (metadata && typeof metadata === 'object') {
      Object.assign(meta, metadata);
      delete meta.pushed_digest;
    }
    const { rows } = await pool.query(
      `INSERT INTO skill_registry (name, description, location, status, metadata, area_id, notion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET
         description = COALESCE(EXCLUDED.description, skill_registry.description),
         location = COALESCE(EXCLUDED.location, skill_registry.location),
         status = CASE WHEN $8::boolean THEN EXCLUDED.status ELSE skill_registry.status END,
         metadata = COALESCE(skill_registry.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         area_id = COALESCE(EXCLUDED.area_id, skill_registry.area_id),
         notion_id = COALESCE(EXCLUDED.notion_id, skill_registry.notion_id),
         updated_at = NOW()
       RETURNING *`,
      [name, description || null, location || null, status || 'active', JSON.stringify(meta), area_id || null, notion_id || null, status !== undefined]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[skills] POST error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/brain/skills/:id
router.patch('/:id', async (req, res) => {
  try {
    const { description, location, status, metadata, notion_id, area_id, notion_synced_at } = req.body;
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const sets = [];
    const vals = [];
    if (description       !== undefined) { vals.push(description);              sets.push(`description = $${vals.length}`); }
    if (location          !== undefined) { vals.push(location);                 sets.push(`location = $${vals.length}`); }
    if (status            !== undefined) { vals.push(status);                   sets.push(`status = $${vals.length}`); }
    if (metadata          !== undefined) {
      const meta = {};
      if (metadata && typeof metadata === 'object') {
        Object.assign(meta, metadata);
        delete meta.pushed_digest;
      }
      vals.push(JSON.stringify(meta));
      sets.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${vals.length}::jsonb`);
    }
    if (notion_id         !== undefined) { vals.push(notion_id);                sets.push(`notion_id = $${vals.length}`); }
    if (area_id           !== undefined) { vals.push(area_id);                  sets.push(`area_id = $${vals.length}`); }
    if (notion_synced_at  !== undefined) { vals.push(notion_synced_at);         sets.push(`notion_synced_at = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'no fields to update' });
    sets.push(`updated_at = NOW()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE skill_registry SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[skills] PATCH error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
