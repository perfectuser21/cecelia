/**
 * User Annotations 路由 — 用户标注 API
 *
 * GET    /api/brain/user-annotations?entity_type=X&entity_id=Y — 查询
 * POST   /api/brain/user-annotations                           — 新增标注
 * PUT    /api/brain/user-annotations/:id                       — 更新内容
 * DELETE /api/brain/user-annotations/:id                       — 删除
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/** GET / — 按 entity 查询标注 */
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query;

    if (!entity_type || !entity_id) {
      return res.status(400).json({
        success: false,
        error: 'entity_type 和 entity_id 为必填查询参数'
      });
    }

    const { rows } = await pool.query(
      `SELECT id, entity_type, entity_id, field_path, content, created_at, updated_at
       FROM user_annotations
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY created_at ASC`,
      [entity_type, entity_id]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[user-annotations] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST / — 新增标注 */
router.post('/', async (req, res) => {
  try {
    const { entity_type, entity_id, field_path, content } = req.body;

    if (!entity_type || !entity_id || !content) {
      return res.status(400).json({
        success: false,
        error: 'entity_type、entity_id、content 为必填项'
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO user_annotations (entity_type, entity_id, field_path, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [entity_type, entity_id, field_path || null, content]
    );

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[user-annotations] POST / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** PUT /:id — 更新内容 */
router.put('/:id', async (req, res) => {
  try {
    const { content, field_path } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'content 为必填项' });
    }

    const { rows } = await pool.query(
      `UPDATE user_annotations
       SET content = $2, field_path = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, content, field_path || null]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[user-annotations] PUT /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** DELETE /:id — 删除标注 */
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM user_annotations WHERE id = $1',
      [req.params.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[user-annotations] DELETE /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
