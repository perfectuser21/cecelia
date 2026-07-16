/**
 * routes/incidents.js — GET /api/brain/incidents 端点
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 * sprint: incidents-layer（刀5-小刀1）
 *
 * I-6: 注册到现有路由文件，不新建服务
 */

import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

/**
 * GET /api/brain/incidents
 * 返回最近 50 条 incidents，按 created_at 降序
 */
router.get('/incidents', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, probe_id, fingerprint, severity, status, task_id,
              recurrence_count, created_at, updated_at, evidence
         FROM incidents
        ORDER BY created_at DESC
        LIMIT 50`
    );
    res.json({ incidents: rows });
  } catch (err) {
    console.error('[incidents] GET /api/brain/incidents 失败:', err.message);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

export default router;
