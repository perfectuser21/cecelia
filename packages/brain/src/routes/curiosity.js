/**
 * Curiosity 路由 — 好奇心评分 API
 *
 * GET /api/brain/curiosity
 *   返回：三维好奇心评分（探索多样性 + 发现质量 + 行动转化）
 *   优先返回缓存；无缓存时实时计算
 */

import { Router } from 'express';
import { calculateCuriosityScore, getCachedScore } from '../curiosity-scorer.js';

const router = Router();

/**
 * GET /
 * 返回当前好奇心评分及三维分项
 */
router.get('/', async (_req, res) => {
  try {
    // 优先返回缓存
    const cached = await getCachedScore();
    if (cached) {
      return res.json({ ...cached, source: 'cache' });
    }

    // 无缓存：实时计算（首次调用）
    const result = await calculateCuriosityScore();
    return res.json({ ...result, source: 'calculated' });
  } catch (err) {
    console.error('[API] curiosity error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /recalculate
 * 强制重新计算评分（不走缓存）
 */
router.post('/recalculate', async (_req, res) => {
  try {
    const result = await calculateCuriosityScore();
    return res.json({ ...result, source: 'recalculated' });
  } catch (err) {
    console.error('[API] curiosity recalculate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
