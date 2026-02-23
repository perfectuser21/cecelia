/**
 * Pattern Analyzer Service - 失败模式识别算法
 *
 * 职责：
 * - 分析任务执行结果，识别失败模式
 * - 支持单次分析和批量分析历史数据
 * - 提供模式识别准确率统计
 */

import pool from './db.js';

/**
 * 失败模式类型定义
 */
const PATTERN_TYPES = {
  TIMEOUT: 'timeout',
  SELECTOR_NOT_FOUND: 'selector_not_found',
  AUTH_EXPIRED: 'auth_expired',
  NETWORK_ERROR: 'network_error',
  RESOURCE_EXHAUSTED: 'resource_exhausted',
  CONFIG_ERROR: 'config_error',
  CODE_ERROR: 'code_error',
  UNKNOWN: 'unknown'
};

/**
 * 模式识别规则
 * 基于 reason_code、reason_kind、layer、step_name 等字段识别模式
 */
const PATTERN_RULES = [
  {
    pattern: PATTERN_TYPES.TIMEOUT,
    conditions: (event) => {
      const reasonCode = (event.reason_code || '').toUpperCase();
      const reasonKind = (event.reason_kind || '').toUpperCase();
      return reasonCode.includes('TIMEOUT') ||
             reasonKind === 'TRANSIENT' && event.retry_count > 2 ||
             (event.metadata?.error_message || '').toLowerCase().includes('timeout');
    },
    weight: 1.0
  },
  {
    pattern: PATTERN_TYPES.SELECTOR_NOT_FOUND,
    conditions: (event) => {
      const reasonCode = (event.reason_code || '').toUpperCase();
      return reasonCode.includes('SELECTOR') ||
             reasonCode.includes('NOT_FOUND') ||
             (event.metadata?.error_message || '').toLowerCase().includes('selector');
    },
    weight: 0.9
  },
  {
    pattern: PATTERN_TYPES.AUTH_EXPIRED,
    conditions: (event) => {
      const reasonCode = (event.reason_code || '').toUpperCase();
      return reasonCode.includes('AUTH') ||
             reasonCode.includes('TOKEN') ||
             reasonCode.includes('SESSION') ||
             (event.metadata?.error_message || '').toLowerCase().includes('auth');
    },
    weight: 0.95
  },
  {
    pattern: PATTERN_TYPES.NETWORK_ERROR,
    conditions: (event) => {
      const reasonCode = (event.reason_code || '').toUpperCase();
      return reasonCode.includes('NETWORK') ||
             reasonCode.includes('CONNECTION') ||
             reasonCode.includes('DNS') ||
             (event.metadata?.error_message || '').toLowerCase().includes('network') ||
             (event.metadata?.error_message || '').toLowerCase().includes('connection');
    },
    weight: 0.85
  },
  {
    pattern: PATTERN_TYPES.RESOURCE_EXHAUSTED,
    conditions: (event) => {
      const reasonCode = (event.reason_code || '').toUpperCase();
      const reasonKind = (event.reason_kind || '').toUpperCase();
      return reasonCode.includes('RESOURCE') ||
             reasonCode.includes('MEMORY') ||
             reasonCode.includes('CPU') ||
             reasonKind === 'RESOURCE';
    },
    weight: 0.9
  },
  {
    pattern: PATTERN_TYPES.CONFIG_ERROR,
    conditions: (event) => {
      const reasonCode = (event.reason_code || '').toUpperCase();
      const reasonKind = (event.reason_kind || '').toUpperCase();
      return reasonCode.includes('CONFIG') ||
             reasonCode.includes('ENV') ||
             reasonKind === 'CONFIG';
    },
    weight: 0.95
  },
  {
    pattern: PATTERN_TYPES.CODE_ERROR,
    conditions: (event) => {
      const reasonCode = (event.reason_code || '').toUpperCase();
      return reasonCode.includes('SYNTAX') ||
             reasonCode.includes('REFERENCE') ||
             reasonCode.includes('TYPE') ||
             (event.metadata?.error_message || '').toLowerCase().includes('error:');
    },
    weight: 0.8
  }
];

/**
 * PatternAnalyzer 类
 */
export default class PatternAnalyzer {
  constructor(dbPool = pool) {
    this.pool = dbPool;
  }

  /**
   * 分析单个失败事件，识别失败模式
   * @param {Object} event - 失败事件对象
   * @returns {Object} 识别结果 { pattern, confidence, details }
   */
  analyzePattern(event) {
    const matchedRules = [];

    for (const rule of PATTERN_RULES) {
      if (rule.conditions(event)) {
        matchedRules.push({
          pattern: rule.pattern,
          weight: rule.weight
        });
      }
    }

    if (matchedRules.length === 0) {
      return {
        pattern: PATTERN_TYPES.UNKNOWN,
        confidence: 0.5,
        details: {
          reason_code: event.reason_code,
          reason_kind: event.reason_kind,
          layer: event.layer,
          step_name: event.step_name
        }
      };
    }

    // 按权重排序，选择最高权重的模式
    matchedRules.sort((a, b) => b.weight - a.weight);
    const bestMatch = matchedRules[0];

    return {
      pattern: bestMatch.pattern,
      confidence: bestMatch.weight,
      details: {
        reason_code: event.reason_code,
        reason_kind: event.reason_kind,
        layer: event.layer,
        step_name: event.step_name,
        matched_patterns: matchedRules.map(m => m.pattern)
      }
    };
  }

  /**
   * 批量分析历史失败数据
   * @param {Object} options - 分析选项
   * @param {number} options.limit - 最多分析多少条记录
   * @param {number} options.offset - 起始偏移量
   * @param {string} options.startDate - 开始日期 (ISO 字符串)
   * @param {string} options.endDate - 结束日期 (ISO 字符串)
   * @returns {Promise<Object>} 批量分析结果
   */
  async batchAnalyze(options = {}) {
    const { limit = 100, offset = 0, startDate, endDate } = options;

    // 构建查询条件
    let whereClause = "status IN ('failed', 'failed_permanent')";
    const params = [];
    let paramIndex = 1;

    if (startDate) {
      whereClause += ` AND ts_start >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND ts_start <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    const query = `
      SELECT
        id, task_id, run_id, span_id, layer, step_name,
        status, reason_code, reason_kind, attempt,
        ts_start, ts_end, input_summary, output_summary, metadata
      FROM run_events
      WHERE ${whereClause}
      ORDER BY ts_start DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const result = await this.pool.query(query, params);
    const events = result.rows;

    // 分析每个事件
    const analyzedEvents = events.map(event => {
      const analysis = this.analyzePattern(event);
      return {
        event_id: event.id,
        task_id: event.task_id,
        run_id: event.run_id,
        layer: event.layer,
        step_name: event.step_name,
        reason_code: event.reason_code,
        reason_kind: event.reason_kind,
        ts_start: event.ts_start,
        ...analysis
      };
    });

    // 统计模式分布
    const patternCounts = {};
    for (const analyzed of analyzedEvents) {
      const pattern = analyzed.pattern;
      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }

    // 计算总事件数和已知模式比例
    const totalEvents = analyzedEvents.length;
    const knownPatterns = analyzedEvents.filter(e => e.pattern !== PATTERN_TYPES.UNKNOWN).length;
    const accuracy = totalEvents > 0 ? (knownPatterns / totalEvents) * 100 : 0;

    return {
      events: analyzedEvents,
      summary: {
        total_analyzed: totalEvents,
        known_patterns: knownPatterns,
        unknown_patterns: totalEvents - knownPatterns,
        accuracy: Math.round(accuracy * 100) / 100,
        pattern_distribution: patternCounts
      },
      pagination: {
        limit,
        offset,
        has_more: events.length === limit
      }
    };
  }

  /**
   * 获取已识别的模式列表
   * @returns {Promise<Object>} 模式列表和统计
   */
  async getPatternList() {
    // 从 failure_signatures 表获取已知的失败签名
    const query = `
      SELECT
        signature,
        count_24h,
        count_7d,
        count_total,
        latest_reason_code,
        latest_layer,
        latest_step_name,
        first_seen_at,
        last_seen_at
      FROM failure_signatures
      ORDER BY count_7d DESC
      LIMIT 50
    `;

    const result = await this.pool.query(query);
    const signatures = result.rows;

    // 对每个签名进行模式识别
    const patterns = signatures.map(sig => {
      const event = {
        reason_code: sig.latest_reason_code,
        layer: sig.latest_layer,
        step_name: sig.latest_step_name,
        retry_count: sig.count_7d
      };

      const analysis = this.analyzePattern(event);

      return {
        signature: sig.signature,
        pattern: analysis.pattern,
        confidence: analysis.confidence,
        count_24h: sig.count_24h,
        count_7d: sig.count_7d,
        count_total: sig.count_total,
        first_seen_at: sig.first_seen_at,
        last_seen_at: sig.last_seen_at
      };
    });

    // 按模式分组统计
    const patternStats = {};
    for (const p of patterns) {
      if (!patternStats[p.pattern]) {
        patternStats[p.pattern] = {
          count: 0,
          signatures: 0
        };
      }
      patternStats[p.pattern].count += p.count_7d;
      patternStats[p.pattern].signatures += 1;
    }

    return {
      patterns,
      summary: patternStats
    };
  }
}

// 导出工具函数（便于测试）
export { PATTERN_TYPES, PATTERN_RULES };
