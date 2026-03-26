/**
 * /api/brain/registry — 系统注册表路由
 *
 * 记录系统里所有东西（skill/cron/api/machine/integration/config）的位置和状态。
 * Claude 创建任何东西前先查这里，创建后登记进来，彻底解决孤岛和重复问题。
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /api/brain/registry
 * 查询注册表，支持过滤
 * ?type=skill|cron|api|machine|integration|config|workflow
 * ?status=active|deprecated|unknown（默认排除 deprecated）
 * ?search=关键词（name/description 模糊搜索）
 * ?limit=100
 */
router.get('/', async (req, res) => {
  try {
    const { type, status, search, limit = 100 } = req.query;
    let query = 'SELECT * FROM system_registry WHERE 1=1';
    const params = [];
    let idx = 1;

    if (type)   { query += ` AND type = $${idx++}`;   params.push(type); }
    if (status) { query += ` AND status = $${idx++}`; params.push(status); }
    else        { query += ` AND status != 'deprecated'`; }
    if (search) {
      query += ` AND (name ILIKE $${idx} OR description ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    query += ` ORDER BY type, name LIMIT $${idx}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[registry] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/registry/exists
 * 检查条目是否已存在（创建前查重）
 * ?type=skill&name=/dev
 * Response: { exists: boolean, item?: object }
 */
router.get('/exists', async (req, res) => {
  try {
    const { type, name } = req.query;
    if (!type || !name) {
      return res.status(400).json({ error: 'type 和 name 均为必填参数' });
    }
    const result = await pool.query(
      'SELECT * FROM system_registry WHERE type = $1 AND name = $2',
      [type, name]
    );
    if (result.rows.length > 0) {
      res.json({ exists: true, item: result.rows[0] });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    console.error('[registry] exists error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/registry/:id
 * 获取单个条目详情
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM system_registry WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '未找到' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brain/registry
 * 登记新条目（创建新 skill/cron/etc 后调用）
 * Body: { type, name, location?, description?, status?, depends_on?, metadata? }
 */
router.post('/', async (req, res) => {
  try {
    const { type, name, location, description, status = 'active', depends_on = [], metadata = {} } = req.body;
    if (!type || !name) {
      return res.status(400).json({ error: 'type 和 name 为必填字段' });
    }
    const result = await pool.query(
      `INSERT INTO system_registry (type, name, location, description, status, depends_on, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (type, name) DO UPDATE SET
         location    = EXCLUDED.location,
         description = EXCLUDED.description,
         status      = EXCLUDED.status,
         depends_on  = EXCLUDED.depends_on,
         metadata    = EXCLUDED.metadata,
         updated_at  = NOW()
       RETURNING *`,
      [type, name, location, description, status, depends_on, JSON.stringify(metadata)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[registry] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/registry/:id
 * 更新条目状态或信息
 */
router.patch('/:id', async (req, res) => {
  try {
    const { status, description, location, metadata, depends_on } = req.body;
    const fields = [], params = [];
    let idx = 1;

    if (status)      { fields.push(`status = $${idx++}`);      params.push(status); }
    if (description) { fields.push(`description = $${idx++}`); params.push(description); }
    if (location)    { fields.push(`location = $${idx++}`);    params.push(location); }
    if (metadata)    { fields.push(`metadata = $${idx++}`);    params.push(JSON.stringify(metadata)); }
    if (depends_on)  { fields.push(`depends_on = $${idx++}`);  params.push(depends_on); }

    if (fields.length === 0) return res.status(400).json({ error: '没有可更新的字段' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE system_registry SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '未找到' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[registry] PATCH error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/brain/registry/:id
 * 软删除（标记为 deprecated）
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE system_registry SET status = 'deprecated', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '未找到' });
    res.json({ message: '已标记为 deprecated', item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
