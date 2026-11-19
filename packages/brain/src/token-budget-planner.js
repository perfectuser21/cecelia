/** 任务执行器偏好与降级判据；运行容量不再采集旧 Claude 订阅预算。 */

// ============================================================
// Executor Affinity（任务降级矩阵）
// ============================================================

/**
 * 每种 task_type 的执行器偏好：
 *   primary:      首选执行器 ('claude' | 'codex')
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
  'crystallize':          { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'crystallize_scope':    { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'crystallize_forge':    { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'crystallize_verify':   { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'crystallize_register': { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'codex_test_gen':       { primary: 'codex',   fallback: null,     no_downgrade: true  },

  // Codex Gate 审查任务类型（始终走 Codex，不消耗 Claude）
  'prd_review':           { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'spec_review':          { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'code_review_gate':     { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'initiative_review':    { primary: 'codex',   fallback: null,     no_downgrade: true  },

  // 始终走 Codex（不消耗 Claude，MiniMax 已停用）
  'explore':              { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'research':             { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'talk':                 { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'data':                 { primary: 'codex',   fallback: null,     no_downgrade: true  },
  'dept_heartbeat':       { primary: 'codex',   fallback: null,     no_downgrade: true  },

  // 内容工厂 Pipeline（始终走 Codex 西安）
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
  EXECUTOR_AFFINITY,
  DEFAULT_AFFINITY,
  getExecutorAffinity,
  shouldDowngrade,
};
