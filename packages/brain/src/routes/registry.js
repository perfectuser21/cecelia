/**
 * System Registry 路由
 *
 * 统一记录系统中所有组件（skill/cron/api/machine/integration）的位置和状态。
 * Claude 创建任何东西前先查这里，彻底解决孤岛和重复问题。
 *
 * GET  /api/brain/registry         — 列表查询（?type=&status=&q=&limit=&offset=）
 * GET  /api/brain/registry/exists  — 存在性检查（?name=X&type=Y）
 * GET  /api/brain/registry/:id     — 详情
 * POST /api/brain/registry         — 注册/upsert（name+type 唯一键）
 * PATCH /api/brain/registry/:id    — 更新 status/location/description/metadata
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const VALID_TYPES = ['skill', 'cron', 'api', 'machine', 'integration', 'other'];
const VALID_STATUSES = ['active', 'inactive', 'deprecated'];

/**
 * GET /api/brain/registry/exists
 * 检查 name+type 组合是否已注册
 *
 * Query params: name, type
 * Response: { exists: boolean, item?: { id, name, type, status, location } }
 */
router.get('/exists', async (req, res) => {
  try {
    const { name, type } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Missing required param: name' });
    }

    const conditions = ['name = $1'];
    const params = [name];

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT id, name, type, status, location, description
       FROM system_registry
       WHERE ${conditions.join(' AND ')}
       LIMIT 1`,
      params
    );

    if (rows.length > 0) {
      return res.json({ exists: true, item: rows[0] });
    }
    return res.json({ exists: false, item: null });
  } catch (err) {
    console.error('[registry] exists error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/registry
 * 列表查询，支持过滤
 *
 * Query params:
 *   type    — skill/cron/api/machine/integration/other
 *   status  — active/inactive/deprecated（默认不过滤）
 *   q       — 关键词模糊搜索（name + description）
 *   limit   — 默认 50，最大 200
 *   offset  — 默认 0
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const conditions = [];
    const params = [];

    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`type = $${params.length}`);
    }

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`status = $${params.length}`);
    }

    if (req.query.q) {
      const qVal = `%${req.query.q}%`;
      params.push(qVal);
      const n1 = params.length;
      params.push(qVal);
      const n2 = params.length;
      conditions.push(`(name ILIKE $${n1} OR description ILIKE $${n2})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, name, type, location, status, description, metadata, registered_at, updated_at
         FROM system_registry
         ${where}
         ORDER BY type, name
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) FROM system_registry ${where}`,
        params.slice(0, -2)
      ),
    ]);

    return res.json({
      items: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[registry] list error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/registry/:id
 * 单条详情
 */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM system_registry WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('[registry] get error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/registry
 * 注册新条目（name+type 已存在则 upsert）
 *
 * Body: { name, type, location?, status?, description?, metadata? }
 */
router.post('/', async (req, res) => {
  try {
    const { name, type, location, status = 'active', description, metadata = {} } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Missing required fields: name, type' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO system_registry (name, type, location, status, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (name, type) DO UPDATE SET
         location = EXCLUDED.location,
         status = EXCLUDED.status,
         description = EXCLUDED.description,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING *`,
      [name, type, location || null, status, description || null, JSON.stringify(metadata)]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[registry] post error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/registry/:id
 * 更新条目（部分更新）
 *
 * Body: { location?, status?, description?, metadata? }
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { location, status, description, metadata } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const updates = [];
    const params = [];

    if (location !== undefined) { params.push(location); updates.push(`location = $${params.length}`); }
    if (status !== undefined) { params.push(status); updates.push(`status = $${params.length}`); }
    if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
    if (metadata !== undefined) { params.push(JSON.stringify(metadata)); updates.push(`metadata = $${params.length}`); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE system_registry SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('[registry] patch error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
