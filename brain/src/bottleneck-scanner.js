/**
 * Bottleneck Scanner Query Service
 *
 * 瓶颈扫描记录查询服务
 * 提供可复用的查询逻辑，支持条件筛选和分页
 */

import pool from '../db.js';

/**
 * 查询瓶颈扫描记录
 * @param {Object} options - 查询选项
 * @param {number} [options.page=1] - 页码
 * @param {number} [options.limit=20] - 每页数量
 * @param {string} [options.startTime] - 开始时间 (ISO 格式)
 * @param {string} [options.endTime] - 结束时间 (ISO 格式)
 * @param {string} [options.type] - 扫描类型
 * @param {string} [options.severity] - 严重程度
 * @returns {Promise<{items: Array, pagination: Object}>}
 */
export async function queryBottleneckScans(options = {}) {
  const {
    page = 1,
    limit = 20,
    startTime,
    endTime,
    type,
    severity
  } = options;

  // 解析分页参数
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * pageLimit;

  // 构建 WHERE 条件
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (startTime) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(startTime);
  }

  if (endTime) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(endTime);
  }

  if (type) {
    conditions.push(`scan_type = $${paramIndex++}`);
    params.push(type);
  }

  if (severity) {
    conditions.push(`severity = $${paramIndex++}`);
    params.push(severity);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 查询总数
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM bottleneck_scans ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.total ?? 0, 10);

  // 查询数据
  const dataParams = [...params, pageLimit, offset];
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
    scan_type: row.scan_type,
    bottleneck_area: row.bottleneck_area,
    severity: row.severity,
    details: row.details,
    recommendations: row.recommendations,
    created_at: row.created_at
  }));

  const totalPages = Math.ceil(total / pageLimit);

  return {
    items,
    pagination: {
      page: pageNum,
      limit: pageLimit,
      total,
      total_pages: totalPages
    }
  };
}

/**
 * 验证查询参数
 * @param {Object} params - 查询参数
 * @returns {Object} - 验证结果 { valid: boolean, errors: string[] }
 */
export function validateQueryParams(params) {
  const errors = [];
  const { page, limit, start_time, end_time, severity } = params;

  // 验证 page
  if (page !== undefined) {
    const pageNum = parseInt(page, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      errors.push('page must be a positive integer');
    }
  }

  // 验证 limit
  if (limit !== undefined) {
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      errors.push('limit must be between 1 and 100');
    }
  }

  // 验证时间格式
  if (start_time) {
    const startDate = new Date(start_time);
    if (isNaN(startDate.getTime())) {
      errors.push('start_time must be a valid ISO date string');
    }
  }

  if (end_time) {
    const endDate = new Date(end_time);
    if (isNaN(endDate.getTime())) {
      errors.push('end_time must be a valid ISO date string');
    }
  }

  // 验证 severity
  const validSeverities = ['low', 'medium', 'high', 'critical'];
  if (severity && !validSeverities.includes(severity)) {
    errors.push(`severity must be one of: ${validSeverities.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  queryBottleneckScans,
  validateQueryParams
};
