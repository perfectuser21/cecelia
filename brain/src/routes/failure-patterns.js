/**
 * Failure Patterns API Routes
 *
 * 失败模式查询 API:
 * - GET /api/failure-patterns - 查询失败模式列表
 * - GET /api/failure-patterns/stats - 查询失败模式统计
 * - POST /api/failure-patterns/analyze - 批量分析失败模式
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /api/failure-patterns
 *
 * 查询失败模式列表
 *
 * Query 参数:
 * - page (默认: 1)
 * - limit (默认: 20, 最大: 100)
 * - trigger_event (可选)
 * - startDate (可选, ISO 格式)
 * - endDate (可选, ISO 格式)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "items": [
 *       {
 *         "id": "uuid",
 *         "title": "...",
 *         "trigger_event": "...",
 *         "content": {...},
 *         "strategy_adjustments": [...],
 *         "applied": false,
 *         "created_at": "..."
 *       }
 *     ],
 *     "pagination": { page, limit, total, total_pages }
 *   }
 * }
 */
router.get('/', async (req, res) => {
  try {
    // 解析分页参数
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // 解析筛选参数
    const { trigger_event, startDate, endDate } = req.query;

    // 构建 WHERE 条件
    const conditions = ['category = $1'];
    const params = ['failure_pattern'];
    let paramIndex = 2;

    if (trigger_event) {
      conditions.push(`trigger_event = $${paramIndex++}`);
      params.push(trigger_event);
    }

    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(endDate);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // 查询总数
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM learnings ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total ?? 0, 10);

    // 查询数据
    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(
      `SELECT id, title, trigger_event, content, strategy_adjustments, applied, created_at, metadata
       FROM learnings
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      dataParams
    );

    const items = dataResult.rows.map(row => ({
      id: row.id,
      title: row.title,
      trigger_event: row.trigger_event,
      content: typeof row.content === 'string'
        ? JSON.parse(row.content)
        : (row.content || {}),
      strategy_adjustments: row.strategy_adjustments,
      applied: row.applied,
      created_at: row.created_at,
      metadata: row.metadata
    }));

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          total_pages: totalPages
        }
      }
    });
  } catch (error) {
    console.error('[Failure Patterns API] Query error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/failure-patterns/stats
 *
 * 查询失败模式统计
 *
 * Query 参数:
 * - days (默认: 7, 最大: 90)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "total": 100,
 *     "period": { "start": "...", "end": "..." },
 *     "by_trigger_event": [
 *       { "trigger_event": "systemic_failure", "count": 50 },
 *       { "trigger_event": "watchdog_kill", "count": 30 },
 *       ...
 *     ],
 *     "by_applied_status": {
 *       "applied": 20,
 *       "not_applied": 80
 *     },
 *     "recent_trends": [
 *       { "date": "2026-02-20", "count": 5 },
 *       ...
 *     ]
 *   }
 * }
 */
router.get('/stats', async (req, res) => {
  try {
    // 解析 days 参数
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));

    // 计算时间范围
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    // 查询总数
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM learnings WHERE category = $1 AND created_at >= $2`,
      ['failure_pattern', start]
    );
    const total = parseInt(totalResult.rows[0]?.total ?? 0, 10);

    // 按 trigger_event 分组统计
    const triggerEventResult = await pool.query(
      `SELECT trigger_event, COUNT(*) as count
       FROM learnings
       WHERE category = $1 AND created_at >= $2
       GROUP BY trigger_event
       ORDER BY count DESC`,
      ['failure_pattern', start]
    );

    const byTriggerEvent = triggerEventResult.rows.map(row => ({
      trigger_event: row.trigger_event,
      count: parseInt(row.count, 10)
    }));

    // 按应用状态统计
    const appliedStatusResult = await pool.query(
      `SELECT applied, COUNT(*) as count
       FROM learnings
       WHERE category = $1 AND created_at >= $2
       GROUP BY applied`,
      ['failure_pattern', start]
    );

    const byAppliedStatus = {
      applied: 0,
      not_applied: 0
    };
    appliedStatusResult.rows.forEach(row => {
      if (row.applied) {
        byAppliedStatus.applied = parseInt(row.count, 10);
      } else {
        byAppliedStatus.not_applied = parseInt(row.count, 10);
      }
    });

    // 查询最近趋势（按天统计）
    const trendsResult = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM learnings
       WHERE category = $1 AND created_at >= $2
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      ['failure_pattern', start]
    );

    const recentTrends = trendsResult.rows.map(row => ({
      date: row.date,
      count: parseInt(row.count, 10)
    }));

    res.json({
      success: true,
      data: {
        total,
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
          days
        },
        by_trigger_event: byTriggerEvent,
        by_applied_status: byAppliedStatus,
        recent_trends: recentTrends
      }
    });
  } catch (error) {
    console.error('[Failure Patterns API] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/failure-patterns/analyze
 *
 * 批量分析失败模式
 *
 * Body 参数:
 * - ids (可选): 要分析的 failure pattern IDs 数组
 * - days (可选): 分析最近 N 天的数据（默认 7）
 * - trigger_event (可选): 只分析特定触发事件
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "patterns": [
 *       {
 *         "id": "uuid",
 *         "title": "...",
 *         "trigger_event": "...",
 *         "content": {...},
 *         "analysis": {
 *           "common_factors": ["..."],
 *           "severity": "high",
 *           "recommendation": "..."
 *         }
 *       }
 *     ],
 *     "summary": {
 *       "total_analyzed": 10,
 *       "common_trigger_events": ["..."],
 *       "overall_severity": "medium"
 *     }
 *   }
 * }
 */
router.post('/analyze', async (req, res) => {
  try {
    const { ids, days = 7, trigger_event: triggerEvent } = req.body;

    // 计算时间范围
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    let query;
    let params;

    if (ids && Array.isArray(ids) && ids.length > 0) {
      // 按 IDs 查询
      query = `
        SELECT id, title, trigger_event, content, strategy_adjustments, created_at
        FROM learnings
        WHERE category = $1 AND id = ANY($2)
        ORDER BY created_at DESC
      `;
      params = ['failure_pattern', ids];
    } else {
      // 按时间范围和触发事件查询
      const conditions = ['category = $1', 'created_at >= $2'];
      let paramIndex = 3;

      if (triggerEvent) {
        conditions.push(`trigger_event = $${paramIndex++}`);
        params = ['failure_pattern', start, triggerEvent];
      } else {
        params = ['failure_pattern', start];
      }

      query = `
        SELECT id, title, trigger_event, content, strategy_adjustments, created_at
        FROM learnings
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 50
      `;
    }

    const result = await pool.query(query, params);

    // 分析失败模式
    const patterns = result.rows.map(row => {
      let content;
      try {
        content = typeof row.content === 'string'
          ? JSON.parse(row.content)
          : (row.content || {});
      } catch {
        content = {};
      }

      // 简单分析：提取共同因素
      const commonFactors = [];
      if (content.root_cause) {
        commonFactors.push(content.root_cause);
      }
      if (content.contributing_factors) {
        commonFactors.push(...content.contributing_factors);
      }

      return {
        id: row.id,
        title: row.title,
        trigger_event: row.trigger_event,
        content,
        strategy_adjustments: row.strategy_adjustments,
        created_at: row.created_at,
        analysis: {
          common_factors: commonFactors.slice(0, 5),
          severity: triggerEvent === 'watchdog_kill' ? 'high' : 'medium',
          recommendation: content.learnings?.[0] || 'Review and apply strategy adjustments'
        }
      };
    });

    // 生成摘要统计
    const triggerEventCounts = {};
    patterns.forEach(p => {
      triggerEventCounts[p.trigger_event] = (triggerEventCounts[p.trigger_event] || 0) + 1;
    });

    const commonTriggerEvents = Object.entries(triggerEventCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([event]) => event);

    const overallSeverity = triggerEventCounts.watchdog_kill
      ? 'high'
      : (triggerEventCounts.systemic_failure ? 'medium' : 'low');

    res.json({
      success: true,
      data: {
        patterns,
        summary: {
          total_analyzed: patterns.length,
          common_trigger_events: commonTriggerEvents,
          overall_severity: overallSeverity
        }
      }
    });
  } catch (error) {
    console.error('[Failure Patterns API] Analyze error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;
