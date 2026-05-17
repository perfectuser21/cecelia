import { Router } from 'express';
import pool from './db.js';

const router = Router();

// POST /api/tasks/:id/links - Create link
router.post('/:id/links', async (req, res) => {
  try {
    const { targetTaskId, linkType } = req.body;
    const sourceTaskId = req.params.id;
    
    if (!targetTaskId || !linkType) {
      return res.status(400).json({ error: 'targetTaskId and linkType are required' });
    }
    
    if (!['blocks', 'blocked_by', 'relates_to', 'duplicates'].includes(linkType)) {
      return res.status(400).json({ error: 'Invalid link type' });
    }
    
    const result = await pool.query(
      'INSERT INTO task_links (source_task_id, target_task_id, link_type) VALUES ($1, $2, $3) RETURNING *',
      [sourceTaskId, targetTaskId, linkType]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Link already exists' });
    }
    res.status(500).json({ error: 'Failed to create link', details: err.message });
  }
});

// DELETE /api/tasks/:id/links/:linkId - Delete link
router.delete('/:id/links/:linkId', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM task_links WHERE id = $1 AND (source_task_id = $2 OR target_task_id = $2) RETURNING id',
      [req.params.linkId, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    res.json({ message: 'Link deleted', id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete link', details: err.message });
  }
});

// GET /api/tasks/:id/links - Get all links for a task
router.get('/:id/links', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT tl.*, t_source.title as source_title, t_target.title as target_title FROM task_links tl LEFT JOIN tasks t_source ON tl.source_task_id = t_source.id LEFT JOIN tasks t_target ON tl.target_task_id = t_target.id WHERE tl.source_task_id = $1 OR tl.target_task_id = $1',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get links', details: err.message });
  }
});

export default router;
