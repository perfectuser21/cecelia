/**
 * DB Schema API Routes
 * Notion-like custom properties management for DatabaseView
 * Stores field definitions in db_schemas table (migration 074)
 */

import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/tasks/db-schema/:stateKey — 获取某个 view 的所有自定义字段
router.get('/:stateKey', async (req, res) => {
  try {
    const { stateKey } = req.params;
    const result = await pool.query(
      `SELECT col_id, col_label, col_type, options, col_width, col_order
       FROM db_schemas
       WHERE state_key = $1
       ORDER BY col_order ASC, created_at ASC`,
      [stateKey]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schema', details: err.message });
  }
});

// POST /api/tasks/db-schema/:stateKey — 添加新自定义字段
router.post('/:stateKey', async (req, res) => {
  try {
    const { stateKey } = req.params;
    const { col_id, col_label, col_type = 'text', options = [], col_width = 150 } = req.body;

    if (!col_id || !col_label) {
      return res.status(400).json({ error: 'col_id and col_label are required' });
    }

    // col_order = max + 1
    const orderResult = await pool.query(
      'SELECT COALESCE(MAX(col_order), -1) + 1 AS next_order FROM db_schemas WHERE state_key = $1',
      [stateKey]
    );
    const col_order = orderResult.rows[0].next_order;

    const result = await pool.query(
      `INSERT INTO db_schemas (state_key, col_id, col_label, col_type, options, col_width, col_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING col_id, col_label, col_type, options, col_width, col_order`,
      [stateKey, col_id, col_label, col_type, JSON.stringify(options), col_width, col_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'col_id already exists for this stateKey' });
    }
    res.status(500).json({ error: 'Failed to create schema field', details: err.message });
  }
});

// PATCH /api/tasks/db-schema/:stateKey/:colId — 更新字段定义
router.patch('/:stateKey/:colId', async (req, res) => {
  try {
    const { stateKey, colId } = req.params;
    const { col_label, col_type, options, col_width, col_order } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (col_label !== undefined) { updates.push(`col_label = $${paramIndex++}`); params.push(col_label); }
    if (col_type !== undefined) { updates.push(`col_type = $${paramIndex++}`); params.push(col_type); }
    if (options !== undefined) { updates.push(`options = $${paramIndex++}`); params.push(JSON.stringify(options)); }
    if (col_width !== undefined) { updates.push(`col_width = $${paramIndex++}`); params.push(col_width); }
    if (col_order !== undefined) { updates.push(`col_order = $${paramIndex++}`); params.push(col_order); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(stateKey, colId);

    const result = await pool.query(
      `UPDATE db_schemas SET ${updates.join(', ')}
       WHERE state_key = $${paramIndex} AND col_id = $${paramIndex + 1}
       RETURNING col_id, col_label, col_type, options, col_width, col_order`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schema field not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update schema field', details: err.message });
  }
});

// DELETE /api/tasks/db-schema/:stateKey/:colId — 删除字段
router.delete('/:stateKey/:colId', async (req, res) => {
  try {
    const { stateKey, colId } = req.params;
    const result = await pool.query(
      'DELETE FROM db_schemas WHERE state_key = $1 AND col_id = $2 RETURNING col_id',
      [stateKey, colId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schema field not found' });
    }
    res.json({ deleted: colId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete schema field', details: err.message });
  }
});

export default router;
