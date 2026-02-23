/**
 * Bottleneck Scan API Routes
 *
 * 瓶颈扫描记录查询 API:
 * - GET /api/health-monitor/bottleneck-scans - 查询瓶颈扫描记录列表
 * - GET /api/health-monitor/bottleneck-scans/:id - 查询单条瓶颈扫描记录详情
 * - GET /api/health-monitor/bottleneck-trends - 趋势分析（严重程度分布 + 瓶颈频率）
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * GET /api/health-monitor/bottleneck-trends
 *
 * 趋势分析：过去 N 天的严重程度分布 + 瓶颈出现频率
 *
 * Query 参数:
 * - days (默认: 1, 最大: 7)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "period": { "start": "...", "end": "..." },
 *     "severity_distribution": [
 *       { "severity": "critical", "count": 5 },
 *       { "severity": "high", "count": 12 },
 *       { "severity": "medium", "count": 30 },
 *       { "severity": "low", "count": 8 }
 *     ],
 *     "bottleneck_frequency": [
 *       { "bottleneck_area": "cpu", "count": 15 },
 *       { "bottleneck_area": "memory", "count": 10 },
 *       ...
 *     ]
 *   }
 * }
 */
router.get('/bottleneck-trends', async (req, res) => {
  try {
    // 解析 days 参数
    const days = Math.min(7, Math.max(1, parseInt(req.query.days, 10) || 1));

    // 计算时间范围
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    // 查询严重程度分布
    const severityResult = await pool.query(
      `SELECT severity, COUNT(*) as count
       FROM bottleneck_scans
       WHERE created_at >= $1 AND created_at <= $2
       GROUP BY severity
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END`,
      [start, end]
    );

    // 查询瓶颈出现频率
    const frequencyResult = await pool.query(
      `SELECT bottleneck_area, COUNT(*) as count
       FROM bottleneck_scans
       WHERE created_at >= $1 AND created_at <= $2
       GROUP BY bottleneck_area
       ORDER BY count DESC`,
      [start, end]
    );

    const severityDistribution = severityResult.rows.map(row => ({
      severity: row.severity,
      count: parseInt(row.count, 10)
    }));

    const bottleneckFrequency = frequencyResult.rows.map(row => ({
      bottleneck_area: row.bottleneck_area,
      count: parseInt(row.count, 10)
    }));

    res.json({
      success: true,
      data: {
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
          days
        },
        severity_distribution: severityDistribution,
        bottleneck_frequency: bottleneckFrequency
      }
    });
  } catch (error) {
    console.error('[Bottleneck API] Trends error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/health-monitor/bottleneck-scans/:id
 *
 * 查询单条瓶颈扫描记录详情
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "id": "uuid",
 *     "scan_type": "...",
 *     "bottleneck_area": "...",
 *     "severity": "...",
 *     "details": {...},
 *     "recommendations": [...],
 *     "created_at": "..."
 *   }
 * }
 */
router.get('/bottleneck-scans/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 验证 UUID 格式
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid ID format'
      });
    }

    // 查询单条记录
    const result = await pool.query(
      `SELECT id, scan_type, bottleneck_area, severity, details, recommendations, created_at
       FROM bottleneck_scans
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bottleneck scan not found'
      });
    }

    const row = result.rows[0];

    // 解析 JSON 字段
    const details = typeof row.details === 'string'
      ? JSON.parse(row.details)
      : (row.details || {});

    const recommendations = typeof row.recommendations === 'string'
      ? JSON.parse(row.recommendations)
      : (row.recommendations || []);

    res.json({
      success: true,
      data: {
        id: row.id,
        scan_type: row.scan_type,
        bottleneck_area: row.bottleneck_area,
        severity: row.severity,
        details,
        recommendations,
        created_at: row.created_at
      }
    });
  } catch (error) {
    console.error('[Bottleneck API] Get by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/health-monitor/bottleneck-scans
 *
 * 查询瓶颈扫描记录列表
 *
 * Query 参数:
 * - page (默认: 1)
 * - limit (默认: 20, 最大: 100)
 * - severity (可选: low, medium, high, critical)
 * - scan_type (可选)
 * - startDate (可选, ISO 格式)
 * - endDate (可选, ISO 格式)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "items": [...],
 *     "pagination": { page, limit, total, total_pages }
 *   }
 * }
 */
router.get('/bottleneck-scans', async (req, res) => {
  try {
    // 解析分页参数
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // 解析筛选参数
    const { severity, scan_type, startDate, endDate } = req.query;

    // 构建 WHERE 条件
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (severity) {
      conditions.push(`severity = $${paramIndex++}`);
      params.push(severity);
    }

    if (scan_type) {
      conditions.push(`scan_type = $${paramIndex++}`);
      params.push(scan_type);
    }

    if (startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM bottleneck_scans ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.total ?? 0, 10);

    // 查询数据
    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(
      `SELECT id, scan_type, bottleneck_area, severity, details, recommendations, created_at
       FROM bottleneck_scans
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      dataParams
    );

    const items = dataResult.rows.map(row => ({
      id: row.id,
      scan_time: row.created_at,
      scan_type: row.scan_type,
      bottleneck_area: row.bottleneck_area,
      severity: row.severity,
      details: row.details,
      recommendations: row.recommendations,
      created_at: row.created_at
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
    console.error('[Bottleneck API] Query error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

export default router;
