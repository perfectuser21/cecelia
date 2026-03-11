/**
 * Rumination 路由 — 反刍系统 API
 *
 * POST /api/brain/rumination/run
 *   手动触发一次反刍消化
 *   Body: { force?: boolean } — force=true 时绕过 daily_budget 限制
 *
 * GET /api/brain/rumination/status
 *   查询反刍系统状态（daily_count, budget, undigested 等）
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';
import { runManualRumination, getRuminationStatus, getUndigestedCount } from '../rumination.js';

const router = Router();

/**
 * POST /run
 * 手动触发一次反刍消化
 */
router.post('/run', async (req, res) => {
  try {
    const force = req.body?.force === true;
    const result = await runManualRumination(pool, { force });
    const remaining = await getUndigestedCount(pool);
    res.json({
      ...result,
      remaining,
      forced: force,
    });
  } catch (err) {
    console.error('[API] rumination/run error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /status
 * 查询反刍系统状态
 */
router.get('/status', async (_req, res) => {
  try {
    const status = await getRuminationStatus(pool);
    res.json(status);
  } catch (err) {
    console.error('[API] rumination/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
