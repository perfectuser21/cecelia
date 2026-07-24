/**
 * gates.js —— merge 硬门禁 + 各上限判断（纯函数，禁 Date.now/Math.random/new Date）。
 * 对齐：routing-extraction.md「merge gate 三道」+ spec P0-2（verdict 锚定 SHA）。
 */
import {
  MAX_POLL_COUNT,
  MAX_HOPS,
  MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK,
  MAX_REBASE_ATTEMPTS,
  BLOCKED_SAME_STATE_CAP,
  BUDGET_CAP_USD,
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

/**
 * caps —— 各上限判断（数值出处 routing-extraction.md，达到即超限）。
 */
export const caps = {
  // 宽兜底；repair 收敛判据必须在 derive 中先于此项执行。
  hopsExceeded: (hops) => hops >= MAX_HOPS,
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
