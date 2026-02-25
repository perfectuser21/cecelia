/**
 * Businesses API Routes
 * CRUD operations for business entities (Stock, ZenithJoy, etc.)
 */

import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/tasks/businesses - List all businesses
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    let query = 'SELECT * FROM businesses';
    let params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list businesses', details: err.message });
  }
});

// GET /api/tasks/businesses/:id - Get business detail
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM businesses WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get business', details: err.message });
  }
});

// POST /api/tasks/businesses - Create business
router.post('/', async (req, res) => {
  try {
    const { name, description, owner, status } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Business name is required' });
    }

    const result = await pool.query(
      'INSERT INTO businesses (name, description, owner, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description || null, owner || null, status || 'active']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create business', details: err.message });
  }
});

// PATCH /api/tasks/businesses/:id - Update business
router.patch('/:id', async (req, res) => {
  try {
    const { name, description, owner, status } = req.body;
    const { id } = req.params;

    // Build dynamic update query
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    if (owner !== undefined) {
      updates.push(`owner = $${paramIndex++}`);
      params.push(owner);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const query = `UPDATE businesses SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update business', details: err.message });
  }
});

// DELETE /api/tasks/businesses/:id - Delete business
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM businesses WHERE id = $1 RETURNING *', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business not found' });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete business', details: err.message });
  }
});

export default router;
