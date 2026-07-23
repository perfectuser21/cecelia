/**
 * gates.js —— merge 硬门禁 + 各上限判断（纯函数，禁 Date.now/Math.random/new Date）。
 * 对齐：routing-extraction.md「merge gate 三道」+ spec P0-2（verdict 锚定 SHA）。
 * Sprint 1b997ed6 新增：deadline gate、no-progress gate、worker budget gate、phase budget gate。
 */
import {
  MAX_FIX_ROUNDS,
  MAX_POLL_COUNT,
  MAX_HOPS,
  MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK,
  MAX_REBASE_ATTEMPTS,
  BLOCKED_SAME_STATE_CAP,
  BUDGET_CAP_USD,
  RUN_DEADLINE_MS,
  PHASE_BUDGETS_MS,
  ROLE_BUDGET_SECS,
} from './constants.js';

/**
 * verdict 归一：Evaluator 会输出 "FIXED"（harness-evaluator-verdict-bug），视同 PASS。
 */
export function isPassVerdict(verdict) {
  return verdict === 'PASS' || verdict === 'FIXED';
}

/**
 * mergeGate —— 唯一 merge 权威（spec 4e，F6 双保险仍在）。
 * 前置门 = evaluate PASS + judge PASS + review_gate 人工（mergePrNode:755 + reportNode 自合语义：
 * 只有 evaluate_verdict==='PASS' 才自合）。
 * P0-2：verdict 对象 {verdict, pr_head_sha}，sha 与当前 PR head 不匹配 = stale，一律拒。
 *
 * @param {{evaluateVerdict:{verdict,pr_head_sha}|null, judgeVerdict:{verdict,pr_head_sha}|null,
 *          prHeadSha:string, reviewRequired:boolean, reviewApproved:boolean}} input
 * @returns {{allow:boolean, reason:string}}
 */
export function mergeGate(input) {
  for (const field of ['evaluateVerdict', 'judgeVerdict', 'prHeadSha', 'reviewRequired', 'reviewApproved']) {
    if (!(field in input)) {
      throw new Error(`mergeGate: missing required field "${field}"`);
    }
  }
  const { evaluateVerdict, judgeVerdict, prHeadSha, reviewRequired, reviewApproved } = input;

  if (!evaluateVerdict) {
    return { allow: false, reason: 'evaluate_verdict_missing' };
  }
  if (evaluateVerdict.pr_head_sha !== prHeadSha) {
    // gates 拒绝 "stale PASS + 新 commit"（P0-2）
    return { allow: false, reason: 'stale_evaluate_verdict' };
  }
  if (!isPassVerdict(evaluateVerdict.verdict)) {
    return { allow: false, reason: 'evaluate_not_pass' };
  }
  if (!judgeVerdict) {
    return { allow: false, reason: 'judge_verdict_missing' };
  }
  if (judgeVerdict.pr_head_sha !== prHeadSha) {
    return { allow: false, reason: 'stale_judge_verdict' };
  }
  if (!isPassVerdict(judgeVerdict.verdict)) {
    return { allow: false, reason: 'judge_not_pass' };
  }
  if (reviewRequired && !reviewApproved) {
    return { allow: false, reason: 'review_not_approved' };
  }
  return { allow: true, reason: 'all_gates_passed' };
}

// ─── Sprint 1b997ed6：deadline gate（纯函数，clock 注入，禁 Date.now/new Date）────

/**
 * isDeadlineExceeded(startedAt, nowAt, budgetMs=RUN_DEADLINE_MS) → boolean
 * 纯函数：nowAt - startedAt >= budgetMs → true（已超时）
 * @param {Date} startedAt  — run 启动时间（来自 DB initiative_runs.created_at）
 * @param {Date} nowAt      — 当前时间（调用方注入，禁止在函数内部调用 Date.now 方法）
 * @param {number} budgetMs — 总预算毫秒数，默认 RUN_DEADLINE_MS（120 分钟）
 * @returns {boolean}
 */
export function isDeadlineExceeded(startedAt, nowAt, budgetMs = RUN_DEADLINE_MS) {
  return (nowAt.getTime() - startedAt.getTime()) >= budgetMs;
}

/**
 * checkNoProgressSameSha(triggerSha, newSha) → boolean
 * generator-fix 完成后 SHA 未变 → true（需要熔断）
 * @param {string} triggerSha — 触发 generator-fix 时的 PR head SHA
 * @param {string|null} newSha — generator-fix 完成后的 PR head SHA
 * @returns {boolean}
 */
export function checkNoProgressSameSha(triggerSha, newSha) {
  if (!newSha) return true; // 空值视为无进展
  return triggerSha === newSha;
}

/**
 * checkNoProgressSameEvidence(triggerDigest, newDigest) → boolean
 * evidence repair 完成后 digest 未变 → true（需要熔断）
 */
export function checkNoProgressSameEvidence(triggerDigest, newDigest) {
  if (!newDigest) return true; // 空值视为无进展
  return triggerDigest === newDigest;
}

/**
 * isPhaseDeadlineExceeded(phase, phaseStartedAt, nowAt) → boolean
 * 阶段预算检查（纯函数，clock 注入）
 * @param {string} phase — 阶段名（PHASE_BUDGETS_MS 的 key）
 * @param {Date} phaseStartedAt — 阶段启动时间
 * @param {Date} nowAt — 当前时间（注入）
 */
export function isPhaseDeadlineExceeded(phase, phaseStartedAt, nowAt) {
  const budgetMs = PHASE_BUDGETS_MS[phase];
  if (budgetMs == null) {
    throw new Error(`isPhaseDeadlineExceeded: unknown phase "${phase}"`);
  }
  return (nowAt.getTime() - phaseStartedAt.getTime()) >= budgetMs;
}

/**
 * computeWorkerDeadlineSecs(role, runStartedAt, nowAt, totalBudgetMs) → number
 * worker spawn 前，supervisor deadline = min(角色上限秒数, run 剩余预算秒数)
 * 返回秒数（非负整数）。
 * @param {string} role — planner/proposer/reviewer/judge/generator/evaluator
 * @param {Date} runStartedAt — run 启动时间
 * @param {Date} nowAt — 当前时间（注入）
 * @param {number} totalBudgetMs — 总预算毫秒数，默认 RUN_DEADLINE_MS
 */
export function computeWorkerDeadlineSecs(role, runStartedAt, nowAt, totalBudgetMs = RUN_DEADLINE_MS) {
  const roleLimitSecs = ROLE_BUDGET_SECS[role];
  if (roleLimitSecs == null) {
    throw new Error(`computeWorkerDeadlineSecs: unknown role "${role}"`);
  }
  const elapsedMs = nowAt.getTime() - runStartedAt.getTime();
  const remainingMs = totalBudgetMs - elapsedMs;
  const remainingSecs = Math.floor(remainingMs / 1000);
  return Math.max(0, Math.min(roleLimitSecs, remainingSecs));
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * caps —— 各上限判断（数值出处 routing-extraction.md，达到即超限）。
 */
export const caps = {
  // 新增 P2：整条 run hop 硬上限
  hopsExceeded: (hops) => hops >= MAX_HOPS,
  // routeAfterFix：超 MAX_FIX_ROUNDS=20 → end
  fixExceeded: (fixRound) => fixRound >= MAX_FIX_ROUNDS,
  // routeAfterPoll：pending 回环超 20×90s → timeout
  pollExceeded: (pollCount) => pollCount >= MAX_POLL_COUNT,
  // GAN 硬保护
  noPushStreakExceeded: (streak) => streak >= MAX_NO_PUSH_STREAK,
  noVerdictStreakExceeded: (streak) => streak >= MAX_NO_VERDICT_STREAK,
  budgetExceeded: (costUsd) => costUsd >= BUDGET_CAP_USD,
  // mergePrNode BEHIND→update-branch(≤3)
  rebaseExceeded: (attempts) => attempts >= MAX_REBASE_ATTEMPTS,
  // loop 四态：NEEDS_CONTEXT/BLOCKED 连续同态 ≥2 → failed
  blockedSameStateExceeded: (streak) => streak >= BLOCKED_SAME_STATE_CAP,
};
