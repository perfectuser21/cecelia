/**
 * Inner Life 路由 — Cecelia 内心活动聚合 API
 *
 * GET /api/brain/inner-life
 *   返回：反刍状态 + 反思累积 + 最近洞察 + pending desires 统计
 */

/* global console */

import { Router } from 'express';
import pool from '../db.js';
import { DAILY_BUDGET } from '../rumination.js';

const router = Router();

/**
 * GET /
 * 聚合 Cecelia 的"内心活动"数据
 */
router.get('/', async (_req, res) => {
  try {
    // 并行查询 4 类数据
    const [
      accumulatorResult,
      insightsResult,
      desireCountResult,
      ruminationResult,
    ] = await Promise.all([
      // 1. 反思累积器
      pool.query(
        "SELECT value_json FROM working_memory WHERE key = 'desire_importance_accumulator'"
      ),

      // 2. 最近洞察（反刍 + 反思，最近 20 条）
      pool.query(`
        SELECT id, content, importance, memory_type, created_at
        FROM memory_stream
        WHERE content LIKE '[反刍洞察]%' OR content LIKE '[反思洞察]%'
        ORDER BY created_at DESC
        LIMIT 20
      `),

      // 3. pending desires 统计
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'expressed') AS expressed,
          COUNT(*) AS total
        FROM desires
        WHERE expires_at IS NULL OR expires_at > NOW()
      `),

      // 4. 反刍状态（未消化数）
      pool.query(
        'SELECT COUNT(*) AS cnt FROM learnings WHERE digested = false'
      ),
    ]);

    // 组装响应
    const accumulator = parseFloat(accumulatorResult.rows[0]?.value_json) || 0;
    const reflectionThreshold = 30;

    const insights = insightsResult.rows.map(r => ({
      id: r.id,
      content: r.content,
      importance: r.importance,
      type: r.content.startsWith('[反刍洞察]') ? 'rumination' : 'reflection',
      created_at: r.created_at,
    }));

    const desireStats = desireCountResult.rows[0] || {};
    const undigestedCount = parseInt(ruminationResult.rows[0]?.cnt || 0);

    res.json({
      rumination: {
        daily_budget: DAILY_BUDGET,
        undigested_count: undigestedCount,
      },
      reflection: {
        accumulator: Math.round(accumulator * 10) / 10,
        threshold: reflectionThreshold,
        progress_pct: Math.min(100, Math.round((accumulator / reflectionThreshold) * 100)),
      },
      insights,
      desires: {
        pending: parseInt(desireStats.pending || 0),
        expressed: parseInt(desireStats.expressed || 0),
        total: parseInt(desireStats.total || 0),
      },
    });
  } catch (err) {
    console.error('[API] inner-life error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
