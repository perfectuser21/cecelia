/**
 * KR 收敛路由 — GET /api/brain/kr/convergence
 *
 * 返回活跃 KR 的优先级排名，包含 top3 主线焦点和暂停/降级建议。
 */

import { Router } from 'express';
import pool from '../db.js';
import { computeKrConvergence } from '../kr-convergence.js';

const router = Router();

/**
 * GET /api/brain/kr/convergence
 * 返回 KR 优先级收敛结果
 */
router.get('/', async (req, res) => {
  try {
    const result = await computeKrConvergence(pool);
    res.json(result);
  } catch (err) {
    console.error('[kr-convergence] 计算失败:', err.message);
    res.status(500).json({
      error: 'KR 收敛计算失败',
      details: err.message,
    });
  }
});

export default router;
