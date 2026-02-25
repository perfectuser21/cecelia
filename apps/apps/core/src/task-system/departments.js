/**
 * Departments API Routes
 * CRUD operations for department entities (Content Team, Tech Team, etc.)
 */

import { Router } from 'express';
import pool from './db.js';

const router = Router();

// GET /api/tasks/departments - List all departments
router.get('/', async (req, res) => {
  try {
    const { business_id } = req.query;

    let query = `
      SELECT d.*, b.name as business_name, b.owner as business_owner
      FROM departments d
      LEFT JOIN businesses b ON d.business_id = b.id
    `;
    let params = [];

    if (business_id) {
      query += ' WHERE d.business_id = $1';
      params.push(business_id);
    }

    query += ' ORDER BY d.created_at DESC';

    const result = await pool.query(query, params);

    // Transform to include business object
    const departments = result.rows.map(row => ({
      id: row.id,
      business_id: row.business_id,
      name: row.name,
      lead: row.lead,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      business: row.business_id ? {
        id: row.business_id,
        name: row.business_name,
        owner: row.business_owner
      } : null
    }));

    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list departments', details: err.message });
  }
});

// GET /api/tasks/departments/:id - Get department detail
router.get('/:id', async (req, res) => {
  try {
    const query = `
      SELECT d.*, b.name as business_name, b.owner as business_owner
      FROM departments d
      LEFT JOIN businesses b ON d.business_id = b.id
      WHERE d.id = $1
    `;
    const result = await pool.query(query, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const row = result.rows[0];
    const department = {
      id: row.id,
      business_id: row.business_id,
      name: row.name,
      lead: row.lead,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      business: row.business_id ? {
        id: row.business_id,
        name: row.business_name,
        owner: row.business_owner
      } : null
    };

    res.json(department);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get department', details: err.message });
  }
});

// POST /api/tasks/departments - Create department
router.post('/', async (req, res) => {
  try {
    const { business_id, name, lead, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    const result = await pool.query(
      'INSERT INTO departments (business_id, name, lead, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [business_id || null, name, lead || null, description || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create department', details: err.message });
  }
});

// PATCH /api/tasks/departments/:id - Update department
router.patch('/:id', async (req, res) => {
  try {
    const { business_id, name, lead, description } = req.body;
    const { id } = req.params;

    // Build dynamic update query
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (business_id !== undefined) {
      updates.push(`business_id = $${paramIndex++}`);
      params.push(business_id);
    }
    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (lead !== undefined) {
      updates.push(`lead = $${paramIndex++}`);
      params.push(lead);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    const query = `UPDATE departments SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update department', details: err.message });
  }
});

// DELETE /api/tasks/departments/:id - Delete department
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING *', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete department', details: err.message });
  }
});

export default router;
