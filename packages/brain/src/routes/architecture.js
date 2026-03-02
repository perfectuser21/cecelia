/**
 * Brain Architecture Routes
 *
 * DB-driven architecture config for brain nodes and connections.
 * Replaces hardcoded NODE_LAYOUT / CONNECTION_PATH in SuperBrain.tsx.
 *
 * GET  /api/brain/architecture          → nodes + connections
 * PATCH /api/brain/architecture/nodes/:id → update node position
 */

import express from 'express';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const router = express.Router();
const pool = new pg.Pool(DB_DEFAULTS);

/**
 * GET /api/brain/architecture
 * Returns all nodes and connections from DB.
 */
router.get('/', async (req, res) => {
  try {
    const [nodesResult, connsResult] = await Promise.all([
      pool.query(`
        SELECT id, block_id, label, nature, pos_x, pos_y
        FROM brain_nodes
        ORDER BY block_id, id
      `),
      pool.query(`
        SELECT id, from_node, to_node, path_type, is_broken
        FROM brain_connections
        ORDER BY id
      `),
    ]);

    res.json({
      nodes: nodesResult.rows,
      connections: connsResult.rows,
      snapshot_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[architecture] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/architecture/nodes/:id
 * Update node position (pos_x, pos_y).
 * Body: { pos_x: number, pos_y: number }
 */
router.patch('/nodes/:id', async (req, res) => {
  const { id } = req.params;
  const { pos_x, pos_y } = req.body;

  if (pos_x === undefined || pos_y === undefined) {
    return res.status(400).json({ error: 'pos_x and pos_y required' });
  }

  try {
    const result = await pool.query(
      `UPDATE brain_nodes SET pos_x = $1, pos_y = $2 WHERE id = $3 RETURNING id`,
      [Math.round(pos_x), Math.round(pos_y), id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Node '${id}' not found` });
    }

    res.json({ ok: true, id, pos_x: Math.round(pos_x), pos_y: Math.round(pos_y) });
  } catch (err) {
    console.error('[architecture] PATCH node error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/brain/architecture/connections/:id
 * Update connection is_broken flag.
 * Body: { is_broken: boolean }
 */
router.patch('/connections/:id', async (req, res) => {
  const { id } = req.params;
  const { is_broken } = req.body;

  if (is_broken === undefined) {
    return res.status(400).json({ error: 'is_broken required' });
  }

  try {
    const result = await pool.query(
      `UPDATE brain_connections SET is_broken = $1 WHERE id = $2 RETURNING id`,
      [Boolean(is_broken), parseInt(id)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Connection '${id}' not found` });
    }

    res.json({ ok: true, id: parseInt(id), is_broken: Boolean(is_broken) });
  } catch (err) {
    console.error('[architecture] PATCH connection error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
