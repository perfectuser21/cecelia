/**
 * dispatch-code-routing — 决策 bf361265（2026-08-11）落地：
 * task_type='dev' 且判定为"改代码"的任务，在 dispatcher.js 派发前改道 harness_initiative，
 * 不再依赖各执行体 hooks/AGENTS.md 自觉遵守 kernel 路由。
 *
 * v1 范围限制：只路由 payload.repo 缺省或等于 'cecelia' 的任务。非默认仓库的路由需要先解决
 * payload.repo → payload.base_repo 的通用映射（harness-worktree.js DEFAULT_BASE_REPO 静默兜底
 * 到 cecelia 本地路径的风险），留作后续任务，本次不处理。
 */

const DOC_OR_CONFIG_ONLY_PATTERN = /^(docs?)\b|^(docs?)\(|^chore\(config\)|纯文档|仅改文档|仅改配置|readme更新|更新文档/i;
const BUGFIX_PATTERN = /^(fix|hotfix|chore)\b|^(fix|hotfix|chore)\(|修复|\bbug\b|小改动/i;
const LARGE_PATTERN = /大功能|新增能力|立项|贯穿|sprint测试|架构重构|breaking change/i;

const DEFAULT_REPO = 'cecelia';

function taskText(task) {
  return `${task?.title || ''} ${task?.description || ''}`;
}

/**
 * classifyCodeChange(task) — 判定一个任务是否属于"改代码类"，命中则应改道 harness_initiative。
 * @returns {{ isCodeChange: boolean, reason: 'not_dev_type'|'doc_or_config_only'|'non_default_repo_v1_scope_limit'|'code_change' }}
 */
export function classifyCodeChange(task) {
  if (task?.task_type !== 'dev') {
    return { isCodeChange: false, reason: 'not_dev_type' };
  }
  const text = taskText(task);
  if (DOC_OR_CONFIG_ONLY_PATTERN.test(text)) {
    return { isCodeChange: false, reason: 'doc_or_config_only' };
  }
  const repo = task?.payload?.repo || DEFAULT_REPO;
  if (repo !== DEFAULT_REPO) {
    return { isCodeChange: false, reason: 'non_default_repo_v1_scope_limit' };
  }
  return { isCodeChange: true, reason: 'code_change' };
}

/**
 * deriveGearForTask(task) — 标题/描述关键词启发式推导 gear（hotfix/default/segmented）。
 * BUGFIX_PATTERN 优先于 LARGE_PATTERN（小修复即使提到"重构"字眼也判 hotfix，宁可偏轻量）。
 * @returns {'hotfix'|'default'|'segmented'}
 */
export function deriveGearForTask(task) {
  const text = taskText(task);
  if (BUGFIX_PATTERN.test(text)) return 'hotfix';
  if (LARGE_PATTERN.test(text)) return 'segmented';
  return 'default';
}

/**
 * buildHarnessRoutingPayload(task, gear) — 改道 harness_initiative 时需要 merge 进
 * taskToDispatch.payload 的字段。除已知两道硬闸（orchestrator/gear）外，额外合成 thin_prd，
 * 避免 Planner（harness-planner/SKILL.md）在 thin_prd 缺省时失去锚点、产出跑题的 sprint-prd.md
 * （thin_prd 不是代码级硬闸，是 LLM subagent 读的操作手册，缺省不报错但会静默跑偏）。
 * @returns {{ orchestrator: 'skill-relay', code_change: true, gear: string, origin_task_type: 'dev', thin_prd: string }}
 */
export function buildHarnessRoutingPayload(task, gear) {
  const parts = [task?.title, task?.description, task?.payload?.context].filter(Boolean);
  return {
    orchestrator: 'skill-relay',
    code_change: true,
    gear,
    origin_task_type: 'dev',
    thin_prd: parts.join('\n\n'),
  };
}
