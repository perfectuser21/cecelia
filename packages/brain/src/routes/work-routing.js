import { Router } from 'express';
import pool from '../db.js';

const router = Router();
router.post('/validate', async (req, res) => {
  const { routing_receipt_id, task_id, repo } = req.body || {};
  if (!routing_receipt_id) return res.status(400).json({ valid: false, reason_code: 'route_violation' });
  const result = await pool.query('SELECT * FROM work_routing_receipts WHERE id=$1 AND task_id=$2 AND repo IS NOT DISTINCT FROM $3', [routing_receipt_id, task_id, repo]);
  const receipt = result.rows[0];
  if (!receipt) return res.status(404).json({ valid: false, reason_code: 'route_violation' });
  return res.json({ valid: true, routing_receipt_id: receipt.id, expires_at: new Date(Date.now() + 60_000).toISOString() });
});
export default router;
