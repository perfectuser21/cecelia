/**
 * Sprint 产物契约（闭环边界 SSOT）。
 * reportNode 在 sprint 结尾产出它；Phase2 读取者（展示/继承/立案）读这一份。
 * 纯函数，不碰 DB。
 */

export const SPRINT_RESULT_CONTRACT_VERSION = 1;

const ARRAY_FIELDS = ['failed_scenarios', 'incidental_bugs', 'improvement_items',
  'linked_issues', 'open_issues_with_learnings', 'node_telemetry', 'sub_tasks', 'ws_issues', 'ws_costs'];

const REQUIRED_KEYS = ['contract_version', 'initiative_id', 'verdict', 'failed_scenarios',
  'change_summary', 'next_action', 'produced_assets', 'learning_ref', 'incidental_bugs',
  'improvement_items', 'linked_issues', 'open_issues_with_learnings', 'node_telemetry',
  'total_tokens', 'total_cost', 'sub_tasks', 'ws_issues', 'ws_costs', 'completed_at'];

/**
 * 从 reportNode 已算好的 locals 组装完整契约。缺失输入用安全默认，永不抛。
 * @param {object} [input]
 */
export function buildSprintResultContract(input = {}) {
  const {
    initiativeId = null, verdict = null, failedScenarios = [], subTasks = [],
    stepTiming = [], wsIssues = [], wsCosts = [], costUsd = 0, completedAt = null,
  } = input || {};

  // ④ node_telemetry：从 stepTiming {node, started_at, duration_ms} 推 start_ts/end_ts
  const node_telemetry = (Array.isArray(stepTiming) ? stepTiming : []).map((s) => {
    let end_ts = null;
    if (s && s.started_at && typeof s.duration_ms === 'number') {
      end_ts = new Date(new Date(s.started_at).getTime() + s.duration_ms).toISOString();
    }
    return {
      node: (s && s.node) || 'unknown',
      start_ts: (s && s.started_at) || null,
      end_ts,
      tokens: null, // TODO(Phase2-采集器)：逐节点 token
      cost: null,   // TODO(Phase2-采集器)
    };
  });

  return {
    contract_version: SPRINT_RESULT_CONTRACT_VERSION,
    initiative_id: initiativeId,

    // ① 结果
    verdict,
    failed_scenarios: Array.isArray(failedScenarios) ? failedScenarios : [],
    change_summary: null, // TODO(Phase2-采集器)：从 PR diff/标题归纳
    next_action: null,    // TODO(Phase2-采集器)

    // ② 产出资产
    produced_assets: { skills: [], tests: [], decisions: [] }, // TODO(Phase2-采集器)
    learning_ref: null,   // TODO(Phase2-采集器)

    // ③ 发现
    incidental_bugs: [],            // TODO(Phase2-采集器)：路上撞见的非本次 bug
    improvement_items: [],          // TODO(Phase2-采集器)：持续改进项（非 bug）
    linked_issues: [],              // TODO(Phase2-采集器)：关联 Notion Issue id
    open_issues_with_learnings: [], // TODO(Phase2-采集器)：未解决 issue + 累积 learning

    // ④ 遥测
    node_telemetry,
    total_tokens: null, // TODO(Phase2-采集器)
    total_cost: typeof costUsd === 'number' ? costUsd : 0,

    // 兼容字段（保留现有 report_content 消费者）
    sub_tasks: Array.isArray(subTasks) ? subTasks : [],
    ws_issues: Array.isArray(wsIssues) ? wsIssues : [],
    ws_costs: Array.isArray(wsCosts) ? wsCosts : [],
    completed_at: completedAt,
  };
}

/**
 * 校验契约结构：四段齐全 + 类型正确。非法抛 Error。
 * @param {object} obj
 * @returns {true}
 */
export function validateSprintResultContract(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('sprint-result-contract: root must be object');
  }
  for (const k of REQUIRED_KEYS) {
    if (!(k in obj)) throw new Error(`sprint-result-contract: missing field "${k}"`);
  }
  if (obj.contract_version !== SPRINT_RESULT_CONTRACT_VERSION) {
    throw new Error(`sprint-result-contract: version ${obj.contract_version} !== ${SPRINT_RESULT_CONTRACT_VERSION}`);
  }
  for (const k of ARRAY_FIELDS) {
    if (!Array.isArray(obj[k])) throw new Error(`sprint-result-contract: "${k}" must be array`);
  }
  const pa = obj.produced_assets;
  if (!pa || typeof pa !== 'object' || !Array.isArray(pa.skills) || !Array.isArray(pa.tests) || !Array.isArray(pa.decisions)) {
    throw new Error('sprint-result-contract: produced_assets must be {skills[],tests[],decisions[]}');
  }
  return true;
}
