/**
 * Acquisition 路由
 *
 * GET /api/brain/acquisition/pending-keyword-tasks?license_key=
 *   — 查询待处理关键词任务；license.credit_balance <= 0 时返回空列表
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /acquisition/pending-keyword-tasks?license_key=CECE-...&limit=
router.get('/acquisition/pending-keyword-tasks', async (req, res) => {
  try {
    const { license_key, limit = 20 } = req.query;
    if (!license_key) {
      return res.status(400).json({ error: '缺少 license_key' });
    }

    // 查 license
    const { rows: licRows } = await pool.query(
      `SELECT id, credit_balance, status FROM licenses WHERE license_key = $1`,
      [license_key]
    );

    if (licRows.length === 0) {
      return res.status(404).json({ error: 'License 不存在' });
    }

    const lic = licRows[0];
    if (lic.status === 'revoked') {
      return res.status(403).json({ error: 'License 已被吊销' });
    }

    // 余额 <= 0 → 返回空列表（不派发）
    if (parseFloat(lic.credit_balance) <= 0) {
      return res.json({ tasks: [], credit_balance: parseFloat(lic.credit_balance) });
    }

    const { rows: tasks } = await pool.query(
      `SELECT id, keyword, status, created_at
       FROM keyword_tasks
       WHERE license_id = $1 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT $2`,
      [lic.id, parseInt(limit, 10)]
    );

    return res.json({
      tasks,
      credit_balance: parseFloat(lic.credit_balance),
    });
  } catch (err) {
    console.error('[acquisition] pending-keyword-tasks error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
