/**
 * Pattern Learner - 增量模式学习
 *
 * 功能：
 * - 从失败中学习新模式
 * - 持久化自定义模式到数据库
 * - 自定义模式优先级高于内置模式
 * - 提供模式统计和历史查询
 */

import pool from './db.js';

/**
 * 失败类别定义
 */
const FAILURE_CLASS = {
  BILLING_CAP: 'billing_cap',
  RATE_LIMIT: 'rate_limit',
  AUTH: 'auth',
  NETWORK: 'network',
  RESOURCE: 'resource',
  TASK_ERROR: 'task_error',
  PARAM_ERROR: 'param_error',
  UNKNOWN: 'unknown',
};

// 参数错误模式
const PARAM_ERROR_PATTERNS = [
  /invalid.*param/i,
  /missing.*field/i,
  /required.*field/i,
  /type.*error/i,
  /validation.*error/i,
  /invalid.*argument/i,
  /cannot.*be.*null/i,
  /undefined.*is.*not.*a.*function/i,
  /cannot.*read.*property/i,
  /is.*not.*defined/i,
  /syntax.*error/i,
];

// 内置模式（用于分类）
const BUILTIN_PATTERNS = {
  billing_cap: [
    /spending\s+cap/i,
    /cap\s+reached/i,
    /billing.*limit/i,
    /usage.*limit.*reached/i,
  ],
  rate_limit: [
    /too\s+many\s+requests/i,
    /rate\s+limit/i,
    /429/,
    /overloaded/i,
    /resource\s+exhausted/i,
    /quota\s+exceeded/i,
  ],
  auth: [
    /permission\s+denied|access\s+denied|unauthorized/i,
    /EACCES|EPERM/i,
    /authentication\s+failed|auth\s+error/i,
    /invalid.*api.*key/i,
    /forbidden/i,
  ],
  network: [
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH/i,
    /connection\s+refused|connection\s+reset/i,
    /network\s+error|socket\s+hang\s+up/i,
    /ECONNRESET/i,
    /5\d{2}\s+error|internal\s+server\s+error/i,
    /service\s+unavailable|bad\s+gateway/i,
    /upstream\s+connect\s+error/i,
  ],
  resource: [
    /ENOMEM|out\s+of\s+memory/i,
    /disk\s+full|no\s+space\s+left/i,
    /ENOSPC/i,
    /oom/i,
  ],
  param_error: PARAM_ERROR_PATTERNS,
};

// 内存缓存（数据库不可用时使用）
let learnedPatternsCache = [];
let learningHistoryCache = [];

/**
 * 初始化：加载已学习的模式
 */
async function initialize() {
  try {
    await ensureTableExists();
    await loadLearnedPatterns();
    console.log('[pattern-learner] Initialized with', learnedPatternsCache.length, 'learned patterns');
  } catch (err) {
    console.error('[pattern-learner] Init error:', err.message);
  }
}

/**
 * 确保表存在
 */
async function ensureTableExists() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS learned_patterns (
      id SERIAL PRIMARY KEY,
      pattern TEXT NOT NULL,
      failure_class TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT NOW(),
      use_count INTEGER DEFAULT 0,
      last_used_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS learning_history (
      id SERIAL PRIMARY KEY,
      error_text TEXT NOT NULL,
      failure_class TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

/**
 * 加载已学习的模式到缓存
 */
async function loadLearnedPatterns() {
  try {
    const result = await pool.query(
      'SELECT pattern, failure_class, source, use_count, created_at FROM learned_patterns ORDER BY use_count DESC'
    );
    learnedPatternsCache = result.rows;
  } catch (err) {
    console.error('[pattern-learner] Failed to load patterns:', err.message);
    learnedPatternsCache = [];
  }
}

/**
 * 分类单个错误（使用内置 + 已学习模式）
 * @param {string} error - 错误信息
 * @returns {{ class: string, confidence: number, pattern?: string, is_learned: boolean }}
 */
function classifyFailure(error) {
  const errorStr = String(error || '');

  // 边界处理：空输入
  if (!errorStr.trim()) {
    return { class: FAILURE_CLASS.UNKNOWN, confidence: 0, is_learned: false };
  }

  // 1. 先检查已学习的自定义模式（优先级最高）
  for (const learned of learnedPatternsCache) {
    try {
      const regex = new RegExp(learned.pattern, 'i');
      if (regex.test(errorStr)) {
        return {
          class: learned.failure_class,
          confidence: 0.95,
          pattern: learned.pattern,
          is_learned: true,
        };
      }
    } catch (e) {
      // 忽略无效正则
    }
  }

  // 2. 检查内置模式（按优先级）
  const patternGroups = [
    { patterns: BUILTIN_PATTERNS.billing_cap, class: FAILURE_CLASS.BILLING_CAP },
    { patterns: BUILTIN_PATTERNS.rate_limit, class: FAILURE_CLASS.RATE_LIMIT },
    { patterns: BUILTIN_PATTERNS.auth, class: FAILURE_CLASS.AUTH },
    { patterns: BUILTIN_PATTERNS.resource, class: FAILURE_CLASS.RESOURCE },
    { patterns: BUILTIN_PATTERNS.param_error, class: FAILURE_CLASS.PARAM_ERROR },
    { patterns: BUILTIN_PATTERNS.network, class: FAILURE_CLASS.NETWORK },
  ];

  for (const group of patternGroups) {
    for (const pattern of group.patterns) {
      if (pattern.test(errorStr)) {
        return {
          class: group.class,
          confidence: 0.9,
          pattern: pattern.toString(),
          is_learned: false,
        };
      }
    }
  }

  // 3. 默认为任务错误
  return {
    class: FAILURE_CLASS.TASK_ERROR,
    confidence: 0.5,
    pattern: null,
    is_learned: false,
  };
}

/**
 * 学习新模式
 * @param {string} error - 错误文本
 * @param {string} failureClass - 正确的失败类别
 * @param {string} source - 来源 (manual/api/auto)
 * @returns {{ success: boolean, pattern_count: number, error?: string }}
 */
async function learnPattern(error, failureClass, source = 'manual') {
  try {
    const errorStr = String(error || '').trim();
    if (!errorStr) {
      return { success: false, error: 'Empty error text', pattern_count: 0 };
    }

    // 验证 failure_class 有效
    const validClasses = Object.values(FAILURE_CLASS);
    if (!validClasses.includes(failureClass)) {
      return { success: false, error: `Invalid failure_class: ${failureClass}`, pattern_count: 0 };
    }

    // 提取模式（简化：取错误的前 100 字符作为模式）
    // 生产环境可以用更智能的关键词提取
    let pattern = errorStr.substring(0, 100);
    if (errorStr.length > 100) {
      // 尝试找到一个好的截断点
      const lastSpace = pattern.lastIndexOf(' ');
      if (lastSpace > 50) {
        pattern = pattern.substring(0, lastSpace);
      }
    }

    // 检查是否已存在相同模式
    const existing = await pool.query(
      'SELECT id FROM learned_patterns WHERE pattern = $1 AND failure_class = $2',
      [pattern, failureClass]
    );

    if (existing.rows.length > 0) {
      // 更新使用计数
      await pool.query(
        'UPDATE learned_patterns SET use_count = use_count + 1, last_used_at = NOW() WHERE id = $1',
        [existing.rows[0].id]
      );
    } else {
      // 插入新模式
      await pool.query(
        'INSERT INTO learned_patterns (pattern, failure_class, source) VALUES ($1, $2, $3)',
        [pattern, failureClass, source]
      );
    }

    // 记录学习历史
    await pool.query(
      'INSERT INTO learning_history (error_text, failure_class, source) VALUES ($1, $2, $3)',
      [errorStr, failureClass, source]
    );

    // 刷新缓存
    await loadLearnedPatterns();

    return {
      success: true,
      pattern_count: learnedPatternsCache.length,
    };
  } catch (err) {
    console.error('[pattern-learner] learnPattern error:', err.message);
    // 内存回退
    learningHistoryCache.push({
      error_text: error,
      failure_class: failureClass,
      source,
      created_at: new Date().toISOString(),
    });
    return {
      success: false,
      error: err.message,
      pattern_count: learnedPatternsCache.length,
    };
  }
}

/**
 * 获取模式统计
 * @returns {{ total: number, by_class: { [class]: number }, learned_count: number }}
 */
async function getPatternStats() {
  try {
    // 统计已学习的模式
    const learnedResult = await pool.query(`
      SELECT failure_class, COUNT(*) as count
      FROM learned_patterns
      GROUP BY failure_class
    `);

    const byClass = {};
    let total = 0;
    for (const row of learnedResult.rows) {
      byClass[row.failure_class] = parseInt(row.count);
      total += parseInt(row.count);
    }

    return {
      total,
      by_class: byClass,
      learned_count: learnedPatternsCache.length,
    };
  } catch (err) {
    console.error('[pattern-learner] getPatternStats error:', err.message);
    return {
      total: 0,
      by_class: {},
      learned_count: learnedPatternsCache.length,
    };
  }
}

/**
 * 获取学习历史
 * @param {number} limit - 返回数量限制
 * @returns {Array}
 */
async function getLearningHistory(limit = 50) {
  try {
    const result = await pool.query(
      'SELECT * FROM learning_history ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (err) {
    console.error('[pattern-learner] getLearningHistory error:', err.message);
    return learningHistoryCache.slice(-limit);
  }
}

/**
 * 批量匹配多个错误
 * @param {string[]} errors - 错误列表
 * @returns {{ results: Array<{ error: string, class: string, confidence: number, is_learned: boolean }> }}
 */
function batchClassify(errors) {
  if (!Array.isArray(errors)) {
    return { results: [] };
  }

  const results = errors.map(error => ({
    error,
    ...classifyFailure(error),
  }));

  return { results };
}

export {
  initialize,
  classifyFailure,
  learnPattern,
  getPatternStats,
  getLearningHistory,
  batchClassify,
  FAILURE_CLASS,
  BUILTIN_PATTERNS,
};
