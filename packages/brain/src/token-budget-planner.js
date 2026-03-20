/**
 * Token Budget Planner
 *
 * 动态计算 Claude / Codex 账号的安全燃烧速率，
 * 为 slot-allocator 提供 budget_state，驱动任务降级矩阵。
 *
 * 设计原则：
 * - 70% 给自主任务，30% 永久保留给用户手动使用（USER_RESERVE_PCT）
 * - 基于 7-day 配额（而非仅 5h 窗口）计算周级别预算
 * - 四种状态：abundant → moderate → tight → critical
 * - 失败时保守降级：返回 moderate（不阻塞，但也不全速跑）
 */

/* global console */

import { getAccountUsage } from './account-usage.js';

// ============================================================
// Constants
// ============================================================

/** 自主任务可用比例（另外 30% 永久留给用户手动使用） */
const USER_RESERVE_PCT = 0.30;

/** 自主任务可用的配额比例 */
const AUTONOMOUS_PCT = 1 - USER_RESERVE_PCT; // 0.70

/**
 * Budget state 阈值（基于所有账号加权平均剩余 7day 配额）
 * remaining = Σ(100 - seven_day_pct) across accounts / account_count
 */
const THRESHOLDS = {
  ABUNDANT:  60,  // remaining > 60%  → 全速运行
  MODERATE:  30,  // remaining > 30%  → 适度节流
  TIGHT:     10,  // remaining > 10%  → 降级非必要任务给 Codex
  // < 10% → CRITICAL → 只跑 Codex + MiniMax
};

/**
 * 各 budget_state 对应的 Pool C 缩放因子
 * slot-allocator 将 raw Pool C × scale_factor 得到实际 Claude 槽数
 */
const POOL_C_SCALE = {
  abundant:  1.0,   // 全容量
  moderate:  0.7,   // 70% 容量
  tight:     0.3,   // 30% 容量（降级任务给 Codex）
  critical:  0.0,   // Claude 槽关闭，全推 Codex/MiniMax
};

// ============================================================
// Executor Affinity（任务降级矩阵）
// ============================================================

/**
 * 每种 task_type 的执行器偏好：
 *   primary:      首选执行器 ('claude' | 'codex' | 'minimax')
 *   fallback:     降级执行器（null = 不降级，排队等待）
 *   no_downgrade: true = 即使 Claude 紧张也不降级（高价值任务）
 */
const EXECUTOR_AFFINITY = {
  // Claude 首选，可降级到 Codex
  'dev':                  { primary: 'claude', fallback: 'codex',   no_downgrade: false },
  'code_review':          { primary: 'claude', fallback: 'codex',   no_downgrade: false },
  'qa_init':              { primary: 'claude', fallback: 'codex',   no_downgrade: false },

  // Claude 首选，不降级（高价值，宁可排队）
  'initiative_execute':   { primary: 'claude', fallback: null,      no_downgrade: true  },
  'architecture_design':  { primary: 'claude', fallback: null,      no_downgrade: true  },
  'architecture_scan':    { primary: 'claude', fallback: null,      no_downgrade: true  },
  'strategy_session':     { primary: 'claude', fallback: null,      no_downgrade: true  },
  'initiative_plan':      { primary: 'claude', fallback: null,      no_downgrade: true  },
  'initiative_verify':    { primary: 'claude', fallback: null,      no_downgrade: true  },
  'arch_review':          { primary: 'claude', fallback: null,      no_downgrade: true  },
  'suggestion_plan':      { primary: 'claude', fallback: null,      no_downgrade: true  },
  'knowledge':            { primary: 'claude', fallback: null,      no_downgrade: true  },

  // 始终走 Codex（不消耗 Claude）
  'codex_dev':            { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'codex_qa':             { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'codex_playwright':     { primary: 'codex',   fallback: null,     no_downgrade: true  },

  // Codex Gate 审查任务类型（始终走 Codex，不消耗 Claude）
  'prd_review':           { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'spec_review':          { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'code_review_gate':     { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'initiative_review':    { primary: 'codex',   fallback: null,     no_downgrade: true  },

  // 始终走 MiniMax（不消耗 Claude）
  'explore':              { primary: 'minimax', fallback: null,     no_downgrade: true  },
  'research':             { primary: 'minimax', fallback: null,     no_downgrade: true  },
  'talk':                 { primary: 'minimax', fallback: null,     no_downgrade: true  },
  'data':                 { primary: 'minimax', fallback: null,     no_downgrade: true  },
  'dept_heartbeat':       { primary: 'minimax', fallback: null,     no_downgrade: true  },
};

/** 未定义的 task_type 默认走 Claude，允许降级到 Codex */
const DEFAULT_AFFINITY = { primary: 'claude', fallback: 'codex', no_downgrade: false };

/**
 * 获取任务的执行器偏好
 * @param {string} taskType
 * @returns {{ primary: string, fallback: string|null, no_downgrade: boolean }}
 */
function getExecutorAffinity(taskType) {
  return EXECUTOR_AFFINITY[taskType] || DEFAULT_AFFINITY;
}

// ============================================================
// Budget Calculation
// ============================================================

/**
 * 计算单个账号的剩余 7-day 配额百分比（考虑 reset 时间）
 * @param {Object} account - account-usage 数据
 * @returns {number} 0~100，0 = 耗尽，100 = 全新
 */
function accountRemainingPct(account) {
  const sevenDayPct = account.seven_day_pct ?? 0;
  const sevenDaySonnetPct = account.seven_day_sonnet_pct ?? 0;

  // 以 sonnet 和 7day 中较高者为基准（更保守的估计）
  const usedPct = Math.max(sevenDayPct, sevenDaySonnetPct);
  const rawRemaining = Math.max(0, 100 - usedPct);

  if (account.seven_day_resets_at) {
    const hours = (new Date(account.seven_day_resets_at) - Date.now()) / 3600000;

    // 即将 reset（< 2 小时）→ 视为已重置
    if (hours <= 2) {
      return 100;
    }

    // 时间加权：离 reset 越近，实际可用比例越高
    // 例：用了 53%（剩 47%），离 reset 还剩 24h / 168h = 14%
    // 只需撑 14% 的时间，47% 的额度绰绰有余 → effectiveRemaining 远高于 47
    const periodFraction = hours / 168;
    if (periodFraction > 0 && periodFraction < 1) {
      const effectiveRemaining = Math.min(100, rawRemaining / periodFraction);
      return effectiveRemaining;
    }
  }

  return rawRemaining;
}

/**
 * 计算距离 reset 的小时数
 * @param {Object} account
 * @returns {number} 小时数，默认 168（7天）
 */
function hoursToReset(account) {
  if (!account.seven_day_resets_at) return 168;
  const hours = (new Date(account.seven_day_resets_at) - Date.now()) / 3600000;
  return Math.max(0.5, hours); // 最少 0.5 小时防除零
}

/**
 * 核心：计算当前 budget_state 和安全 Claude 槽位数
 *
 * @param {Object} [usageOverride] - 测试用，覆盖 getAccountUsage() 返回值
 * @returns {Promise<Object>} {
 *   state: 'abundant'|'moderate'|'tight'|'critical',
 *   avg_remaining_pct: number,       // 所有账号平均剩余 7day 配额 %
 *   pool_c_scale: number,            // Pool C 缩放因子 (0~1)
 *   autonomous_reserve_pct: number,  // 自主任务可用比例 (0.70)
 *   accounts: Array,                 // 各账号明细
 *   budget_breakdown: Object,        // 调试信息
 * }
 */
async function calculateBudgetState(usageOverride = null) {
  let usage;
  try {
    if (usageOverride) {
      usage = usageOverride;
    } else {
      const result = await getAccountUsage();
      usage = result || {};
    }
  } catch (err) {
    console.warn(`[token-budget-planner] getAccountUsage failed: ${err.message}, using conservative moderate`);
    return _conservativeFallback();
  }

  const accounts = Object.values(usage).filter(a => a && typeof a === 'object');

  if (accounts.length === 0) {
    console.warn('[token-budget-planner] No account data, using conservative moderate');
    return _conservativeFallback();
  }

  // 各账号明细
  const accountDetails = accounts.map(a => ({
    account_id: a.account_id,
    remaining_pct: accountRemainingPct(a),
    hours_to_reset: hoursToReset(a),
    seven_day_pct: a.seven_day_pct ?? 0,
    seven_day_sonnet_pct: a.seven_day_sonnet_pct ?? 0,
    // 安全燃烧速率：每小时可用的配额百分点（已乘以自主比例）
    safe_rate_per_hour: (accountRemainingPct(a) * AUTONOMOUS_PCT) / hoursToReset(a),
  }));

  // 加权平均剩余（用于 state 判断）
  const avgRemaining = accountDetails.reduce((s, a) => s + a.remaining_pct, 0) / accountDetails.length;

  // 判断 state
  let state;
  if (avgRemaining > THRESHOLDS.ABUNDANT) {
    state = 'abundant';
  } else if (avgRemaining > THRESHOLDS.MODERATE) {
    state = 'moderate';
  } else if (avgRemaining > THRESHOLDS.TIGHT) {
    state = 'tight';
  } else {
    state = 'critical';
  }

  const poolCScale = POOL_C_SCALE[state];

  console.log(`[token-budget-planner] state=${state} avg_remaining=${avgRemaining.toFixed(1)}% pool_c_scale=${poolCScale}`);

  return {
    state,
    avg_remaining_pct: Math.round(avgRemaining * 10) / 10,
    pool_c_scale: poolCScale,
    autonomous_reserve_pct: AUTONOMOUS_PCT,
    user_reserve_pct: USER_RESERVE_PCT,
    accounts: accountDetails,
    budget_breakdown: {
      thresholds: THRESHOLDS,
      account_count: accounts.length,
    },
  };
}

/**
 * 保守降级：无法获取数据时返回 moderate（不阻塞但也不全速）
 */
function _conservativeFallback() {
  return {
    state: 'moderate',
    avg_remaining_pct: 50,
    pool_c_scale: POOL_C_SCALE.moderate,
    autonomous_reserve_pct: AUTONOMOUS_PCT,
    user_reserve_pct: USER_RESERVE_PCT,
    accounts: [],
    budget_breakdown: { fallback: true },
  };
}

// ============================================================
// Downgrade Decision
// ============================================================

/**
 * 判断某个任务是否应该降级到 Codex 执行
 *
 * 降级条件：
 *   1. budget_state 是 'tight' 或 'critical'
 *   2. 任务有 fallback executor（no_downgrade = false）
 *   3. fallback 是 'codex'
 *
 * @param {string} taskType
 * @param {string} budgetState - 'abundant'|'moderate'|'tight'|'critical'
 * @returns {boolean}
 */
function shouldDowngrade(taskType, budgetState) {
  if (budgetState !== 'tight' && budgetState !== 'critical') return false;

  const affinity = getExecutorAffinity(taskType);
  if (affinity.no_downgrade) return false;
  if (affinity.fallback !== 'codex') return false;

  return true;
}

// ============================================================
// Exports
// ============================================================

export {
  USER_RESERVE_PCT,
  AUTONOMOUS_PCT,
  THRESHOLDS,
  POOL_C_SCALE,
  EXECUTOR_AFFINITY,
  DEFAULT_AFFINITY,
  getExecutorAffinity,
  calculateBudgetState,
  shouldDowngrade,
  accountRemainingPct,
  hoursToReset,
};
