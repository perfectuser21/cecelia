/**
 * d707-replay.test.js
 *
 * [BEHAVIOR] B-08：d707 hop 55-66 replay 不产生重复 fix
 *
 * 先红后绿：当前代码在 hop 56（verdict:judge FAIL）路由 generator-fix，
 * 在 hop 57-66 产生 10 次重复 spawn:generator-fix（同 SHA dc7e1bc0...，no-progress 未熔断）。
 *
 * 真实 d707ae20 run 的关键 hop 结构（从 DB 提取）：
 *   hop 53: spawn:evaluator（PR ci=pass，sha=dc7e1bc0...）
 *   hop 54: verdict:evaluate（PASS, sha=dc7e1bc0...）
 *   hop 55: spawn:judge（evaluate PASS 后触发 judge 机械闸）
 *   hop 56: verdict:judge（FAIL，机械闸：behavior_tests 缺 exit_code + log_tail 为空）
 *   hop 57: spawn:generator-fix（reason=judge_fail，sha 仍=dc7e1bc0...）
 *   hop 58-66: 9 次重复 spawn:generator-fix（同 SHA，no-progress 未熔断）
 *
 * 修复后期望：
 *   hop 56: verdict:judge（FAIL）
 *   hop 57: mark_failed（no_progress_same_sha：judge_fail 后 SHA 未前进）
 *   或
 *   hop 57: spawn:generator-fix（fix_cap 检查：fix >= MAX_FIX_ROUNDS 后 terminal）
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 *
 * 修订说明（round-2）：
 * - C-1 修复：baselineDecisionLog 替换为真实 d707ae20 run DB 导出数据（66 hops 完整）
 * - 真实 Bug 是 verdict:judge FAIL 后循环 generator-fix（同 SHA），不是 evidence_invalid
 */

import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';

// ---- d707 replay fixture（真实数据，从 DB 导出 d707ae20-2286-4d6e-a2fe-dc6a9bcf4e92）----
// 字段：{ hop, action, observed, detail }
// DB 列：hop, action, observed(jsonb), detail(jsonb)

const D707_REAL_DECISION_LOG = [
  { hop: 1, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 0, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 2, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 1, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 3, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 2, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 4, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 3, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 5, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 4, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 6, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 5, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 7, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 6, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 8, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 7, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 9, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 8, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 10, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 9, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 11, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 10, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 12, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 11, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 13, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 12, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 14, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 13, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 15, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 14, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 16, action: 'spawn:planner', observed: { prdExists: false, pr: null, counters: { hops: 15, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_prd', crossCheckMismatch: false } },
  { hop: 17, action: 'spawn:proposer', observed: { prdExists: true, pr: null, counters: { hops: 16, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0 }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: 0, auth_failed: false } }, detail: { reason: 'no_contract_yet', crossCheckMismatch: false } },
  { hop: 18, action: 'spawn:proposer', observed: { prdExists: true, pr: null, counters: { hops: 17, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: 0, auth_failed: false }, propose_branch_advanced: false }, detail: { reason: 'no_contract_yet', crossCheckMismatch: true } },
  { hop: 19, action: 'spawn:proposer', observed: { prdExists: true, pr: null, counters: { hops: 18, fixRound: 0, ganRound: 0, pollCount: 0, ganCostUsd: 0, noPushStreak: 1, noVerdictStreak: 0, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 0, lastAgentExit: { code: 0, auth_failed: false }, propose_branch_advanced: false }, detail: { reason: 'no_contract_yet', crossCheckMismatch: true } },
  { hop: 20, action: 'spawn:proposer', observed: { recovery: 'canonical_branch_published', proposeBranchRn: 1, propose_branch_advanced: true }, detail: { branch: 'cp-harness-propose-r1-f5bf5b50-a19', reason: 'preserve append-only history while recording recovered external truth', source_commit: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', administrative_recovery: true } },
  { hop: 21, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 20, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 22, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 21, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: 126, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 23, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 22, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: 126, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 24, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 23, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 2, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: 126, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 25, action: 'spawn:reviewer', observed: { recovery: 'grok_linux_launcher_deployed', proposeBranchRn: 1 }, detail: { reason: 'retry after preserving four Mach-O provider_exit failures; no verdict claimed', deployed_sha: 'f24b5f907246c57ea1e8d45cbe414228ec31c27a', administrative_recovery: true } },
  { hop: 26, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 25, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: null, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 27, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 26, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: null, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 28, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 27, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 2, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: 0, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 29, action: 'spawn:reviewer', observed: { recovery: 'grok_structured_output_runner_deployed', deployed_sha: '09baf7489ebcb06646e31fc36d1553f5928ccd02' }, detail: { reason: 'retry after deploying verified Grok always-approve and camelCase structuredOutput support; no verdict claimed', deployed_sha: '09baf7489ebcb06646e31fc36d1553f5928ccd02', administrative_recovery: true } },
  { hop: 30, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 29, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: null, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 31, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 30, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: 0, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 32, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 31, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 2, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: 0, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 33, action: 'spawn:reviewer', observed: { recovery: 'uuid_callback_fix_deployed', deployed_sha: '9206370703311d3aa893559be6b363e2685b7b84' }, detail: { reason: 'fresh authenticated callback fire after deploying UUID-typed verdict persistence; no verdict claimed', deployed_sha: '9206370703311d3aa893559be6b363e2685b7b84', administrative_recovery: true } },
  { hop: 34, action: 'spawn:reviewer', observed: { prdExists: true, pr: null, counters: { hops: 33, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 0, crossCheckMismatch: true }, contractApproved: false, inflightContainers: 0, proposeBranchRn: 1, lastAgentExit: { code: null, auth_failed: false }, verdict_parsed: false }, detail: { reason: 'contract_r1_awaiting_review', crossCheckMismatch: true } },
  { hop: 35, action: 'verdict:reviewer', observed: { role: 'reviewer', attempt_id: '1c6e0bbc-6ba5-4951-aefc-e9ee11ea67c6' }, detail: { rn: 1, verdict: 'APPROVED', feedback: '七维全部≥7：DoD机检性8 Scope9 Test真红9 内部一致8 风险7 Oracle8 CI10。无PRD未覆盖阻塞项。', attempt_id: '1c6e0bbc-6ba5-4951-aefc-e9ee11ea67c6' } },
  { hop: 36, action: 'spawn:generator', observed: { prdExists: true, pr: null, counters: { hops: 35, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'contract_approved', crossCheckMismatch: true } },
  { hop: 37, action: 'spawn:generator-fix', observed: { prdExists: true, pr: null, counters: { hops: 36, fixRound: 0, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_pr', crossCheckMismatch: true } },
  { hop: 38, action: 'spawn:generator-fix', observed: { prdExists: true, pr: null, counters: { hops: 37, fixRound: 1, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 1, auth_failed: false } }, detail: { reason: 'no_pr', crossCheckMismatch: true } },
  { hop: 39, action: 'spawn:generator-fix', observed: { prdExists: true, pr: null, counters: { hops: 38, fixRound: 2, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 1, auth_failed: false } }, detail: { reason: 'no_pr', crossCheckMismatch: true } },
  { hop: 40, action: 'spawn:generator-fix', observed: { prdExists: true, pr: null, counters: { hops: 39, fixRound: 3, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 1, auth_failed: false } }, detail: { reason: 'no_pr', crossCheckMismatch: true } },
  { hop: 41, action: 'spawn:generator-fix', observed: { prdExists: true, pr: null, counters: { hops: 40, fixRound: 4, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_pr', crossCheckMismatch: true } },
  { hop: 42, action: 'spawn:evaluator', observed: { prdExists: true, pr: { ci: 'pass', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '3577d1c1d04eb90070496af20b373245703cb9f9', mergeStateStatus: 'BEHIND' }, counters: { hops: 41, fixRound: 5, ganRound: 1, pollCount: 5, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_evaluate_verdict_for_head_sha', crossCheckMismatch: true } },
  { hop: 43, action: 'spawn:generator-fix', observed: { prdExists: true, pr: { ci: 'pass', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '3577d1c1d04eb90070496af20b373245703cb9f9', mergeStateStatus: 'BEHIND' }, counters: { hops: 42, fixRound: 5, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 1, auth_failed: false } }, detail: { reason: 'container_exit', crossCheckMismatch: true } },
  { hop: 44, action: 'spawn:evaluator', observed: { prdExists: true, pr: { ci: 'pass', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '3577d1c1d04eb90070496af20b373245703cb9f9', mergeStateStatus: 'UNKNOWN' }, counters: { hops: 43, fixRound: 6, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_evaluate_verdict_for_head_sha', crossCheckMismatch: true } },
  { hop: 45, action: 'verdict:evaluate', observed: { role: 'evaluator', attempt_id: '0eb26b60-868a-420d-9cb2-9fc8f9b32fe2' }, detail: { verdict: 'PASS', feedback: '合同全部可验证断言（E2E脚本、4条BEHAVIOR、ARTIFACT、INV）真实执行均通过，且通过旧/新正则对比确认修复非空转、真实解决了\'明确失败被OOM宽免吞掉\'的问题；未违反任何范围限定（未碰brain/src、无DB migration）；CI绿且PR仍停在人审门。允许进入merge。', attempt_id: '0eb26b60-868a-420d-9cb2-9fc8f9b32fe2', pr_head_sha: '3577d1c1d04eb90070496af20b373245703cb9f9', failure_class: null } },
  { hop: 46, action: 'spawn:evaluator', observed: { prdExists: true, pr: { ci: 'pass', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '3577d1c1d04eb90070496af20b373245703cb9f9', mergeStateStatus: 'BEHIND' }, counters: { hops: 44, fixRound: 6, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 0, action: 'spawn:evaluator', auth_failed: false } }, detail: { reason: 'no_evaluate_verdict_for_head_sha', crossCheckMismatch: true } },
  { hop: 47, action: 'spawn:generator-fix', observed: { prdExists: true, pr: { ci: 'fail', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '710f0d900ac4427bad595e8d52ca6988d34b27dd', mergeStateStatus: 'UNKNOWN' }, counters: { hops: 46, fixRound: 6, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'ci_fail', crossCheckMismatch: true } },
  { hop: 48, action: 'spawn:generator-fix', observed: { prdExists: true, pr: { ci: 'fail', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '710f0d900ac4427bad595e8d52ca6988d34b27dd', mergeStateStatus: 'BEHIND' }, counters: { hops: 47, fixRound: 7, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'ci_fail', crossCheckMismatch: true } },
  { hop: 49, action: 'spawn:evaluator', observed: { prdExists: true, pr: { ci: 'pass', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '91ce514b24ed942448b6875d24e1f6b7a71bb6a5', mergeStateStatus: 'BEHIND' }, counters: { hops: 48, fixRound: 8, ganRound: 1, pollCount: 3, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 0, action: 'spawn:generator-fix', auth_failed: false } }, detail: { reason: 'no_evaluate_verdict_for_head_sha', crossCheckMismatch: true } },
  { hop: 50, action: 'verdict:evaluate', observed: { role: 'evaluator', attempt_id: '1d12f17d-fd7f-4d4a-b8a0-78896aee8e5f' }, detail: { verdict: 'PASS', feedback: '合同全部可验证断言（4条BEHAVIOR+3条ARTIFACT+INV条目+Golden Path覆盖+禁mock边核查）均真实执行且通过，源码 diff 确认修复对应根因，允许 merge', attempt_id: '1d12f17d-fd7f-4d4a-b8a0-78896aee8e5f', pr_head_sha: '91ce514b24ed942448b6875d24e1f6b7a71bb6a5', failure_class: null } },
  { hop: 51, action: 'spawn:generator-fix', observed: { prdExists: true, pr: { ci: 'fail', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '143b2a413ab3ef458354a50433ccc9adc1da761d', mergeStateStatus: 'BEHIND' }, counters: { hops: 50, fixRound: 8, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 0, action: 'spawn:evaluator', auth_failed: false } }, detail: { reason: 'ci_fail', crossCheckMismatch: true } },
  { hop: 52, action: 'spawn:generator-fix', observed: { prdExists: true, pr: { ci: 'fail', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: '143b2a413ab3ef458354a50433ccc9adc1da761d', mergeStateStatus: 'BEHIND' }, counters: { hops: 51, fixRound: 9, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 137, action: 'spawn:generator-fix', auth_failed: false } }, detail: { reason: 'container_exit', crossCheckMismatch: true } },
  { hop: 53, action: 'spawn:evaluator', observed: { prdExists: true, pr: { ci: 'pass', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7', mergeStateStatus: 'CLEAN' }, counters: { hops: 52, fixRound: 10, ganRound: 1, pollCount: 2, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: null, auth_failed: false } }, detail: { reason: 'no_evaluate_verdict_for_head_sha', crossCheckMismatch: true } },
  { hop: 54, action: 'verdict:evaluate', observed: { role: 'evaluator', attempt_id: '7310e99f-bd1c-4ab7-9f63-83a28b0f518f' }, detail: { verdict: 'PASS', feedback: 'PR 分支上的真实 E2E 脚本与全部四条 [BEHAVIOR] manual:bash 断言均真跑通过（退出码 0），Golden Path 三步均有对应命令+断言覆盖，ARTIFACT/INV 机械检查全部通过，禁 mock 边清单核查未发现违规，范围未触碰 packages/brain/src 或 DB migration，可放行 merge。', attempt_id: '7310e99f-bd1c-4ab7-9f63-83a28b0f518f', pr_head_sha: 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7', failure_class: null } },
  // hop 55: evaluate PASS 后进入 judge（机械闸）
  { hop: 55, action: 'spawn:judge', observed: { prdExists: true, pr: { ci: 'pass', url: 'https://github.com/perfectuser21/cecelia/pull/4204', state: 'OPEN', merged: false, head_sha: 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7', mergeStateStatus: 'CLEAN' }, counters: { hops: 54, fixRound: 10, ganRound: 1, pollCount: 0, ganCostUsd: 0, noPushStreak: 0, noVerdictStreak: 1, crossCheckMismatch: true }, contractApproved: true, inflightContainers: 0, proposeBranchRn: 1, proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483', lastAgentExit: { code: 0, action: 'spawn:evaluator', auth_failed: false } }, detail: { reason: 'evaluate_passed_awaiting_judge', crossCheckMismatch: true } },
];

// hop 56: verdict:judge FAIL（机械闸失败，behavior_tests 缺 exit_code + log_tail 为空）
const D707_HOP56_JUDGE_VERDICT = {
  hop: 56,
  action: 'verdict:judge',
  observed: { pr: { head_sha: 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7' } },
  detail: {
    verdict: 'FAIL',
    pr_head_sha: 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7',
    feedback: '机械闸 FAIL（无闸不成文 dc18d43d）：\n- behavior_tests[0] 缺 exit_code（无退出码证据；0 合法）\n- behavior_tests[0] log_tail 为空且无 agentStdout/transcript 命令输出兜底（无执行证据）\n- contract_tests 为 0（sprint 目录无 *.test.{ts,js,mjs,sh}，contract-dod.md 亦无 [BEHAVIOR]）',
  },
};

// hop 57-66: spawn:generator-fix（同 SHA dc7e1bc0...，10 次重复，真实 Bug）
const D707_HOP57_66_REPEATED_FIX = Array.from({ length: 10 }, (_, i) => ({
  hop: 57 + i,
  action: 'spawn:generator-fix',
  observed: {
    prdExists: true,
    pr: {
      ci: 'pass',
      url: 'https://github.com/perfectuser21/cecelia/pull/4204',
      state: 'OPEN',
      merged: false,
      head_sha: 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7', // 同一 SHA，no-progress！
      mergeStateStatus: 'CLEAN',
    },
    counters: {
      hops: 56 + i,
      fixRound: 10 + i + 1,
      ganRound: 1,
      pollCount: 0,
      ganCostUsd: 0,
      noPushStreak: 0,
      noVerdictStreak: 1,
      crossCheckMismatch: true,
    },
    contractApproved: true,
    inflightContainers: 0,
    proposeBranchRn: 1,
    proposeBranchSha: '3a5c5ef83d1008c9f2e3888adde7e2533bc0a483',
    lastAgentExit: { code: i === 0 ? null : 0, action: 'spawn:generator-fix', auth_failed: false },
  },
  detail: { reason: 'judge_fail', crossCheckMismatch: true },
}));

// 关键 SHA 常量
const D707_FINAL_SHA = 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7';

describe('[BEHAVIOR] B-08 d707 hop 55-66 replay 不产生重复 fix', () => {

  /**
   * T-04-a: hop 56 verdict:judge FAIL → 路由正确（不是无限 generator-fix）
   * 真实 Bug：verdict:judge FAIL 后 derive 循环 spawn:generator-fix（同 SHA，10 次重复）
   * 修复后期望：judge FAIL + SHA 未变化 → no_progress_same_sha terminal
   * 或：judge FAIL → mark_failed(fix_cap) 当 fixRound >= MAX
   */
  test('T-04-a: hop 56 verdict:judge FAIL + 同 SHA → 不继续 spawn:generator-fix（no-progress 或 fix_cap）', () => {
    const logWithHop56 = [
      ...D707_REAL_DECISION_LOG,
      D707_HOP56_JUDGE_VERDICT,
    ];

    const counters = deriveCounters(logWithHop56, { proposeBranchMaxRn: 0 });

    const observed = {
      run: { phase: 'judge', cost_usd: '5.00' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c-d707', row: {} },
      pr: {
        url: 'https://github.com/perfectuser21/cecelia/pull/4204',
        state: 'OPEN',
        merged: false,
        ci: 'pass',
        head_sha: D707_FINAL_SHA,
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 1,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: {
        verdict: 'PASS',
        pr_head_sha: D707_FINAL_SHA,
        failure_class: null,
      },
      evaluateResult: null,
      judgeVerdict: {
        verdict: 'FAIL',
        pr_head_sha: D707_FINAL_SHA,
        feedback: '机械闸 FAIL：behavior_tests 缺 exit_code + log_tail 为空',
      },
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logWithHop56,
      authCircuit: [],
      callbackResult: null,
      // fixRound=10 已超过旧 MAX_FIX_ROUNDS=20 很高（真实数据），实现后 MAX=3 会熔断
      counters: { ...counters, pollCount: counters.pollCount ?? 0, ganCostUsd: 5.00 },
    };

    const result = derive(observed);

    // 实现后期望：任意 terminal 动作（no_progress 或 fix_cap）
    // 当前（先红）：无 no-progress 检测，judge_fail → generator-fix 无限循环
    expect(result.action).not.toBe('spawn:generator-fix');
    // 期望 terminal：mark_failed（fix_cap 或 no_progress_same_sha）
    expect(['mark_failed', 'exit']).toContain(result.action);
  });

  /**
   * T-04-b: hop 57 generator-fix callback same SHA → no_progress terminal
   * 即使进了 generator-fix，callback same SHA 也必须 terminal
   */
  test('T-04-b: generator-fix callback same SHA → no_progress_same_sha', () => {
    const prHeadSha = D707_FINAL_SHA;
    const logWithSameShaFix = [
      ...D707_REAL_DECISION_LOG.slice(0, 40), // 前 40 hop 的精简版
      {
        hop: 41,
        action: 'spawn:generator-fix',
        observed: {
          trigger_sha: prHeadSha, // 记录当时的 PR head_sha
          failure_class: 'judge_fail',
        },
      },
      {
        hop: 42,
        action: 'verdict:generator-fix-callback',
        observed: {
          pr_head_sha: prHeadSha, // same SHA → no-progress
        },
      },
    ];

    const counters = deriveCounters(logWithSameShaFix, { proposeBranchMaxRn: 0 });

    const observed = {
      run: { phase: 'generate', cost_usd: '3.00' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c-d707', row: {} },
      pr: {
        url: 'https://github.com/perfectuser21/cecelia/pull/4204',
        state: 'OPEN',
        merged: false,
        ci: 'pass',
        head_sha: prHeadSha, // SHA 仍未变化
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: null,
      evaluateResult: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logWithSameShaFix,
      noProgress: true, // 实现后 ground-truth 推导此字段
      noProgressReason: 'same_sha',
      authCircuit: [],
      callbackResult: null,
      counters: {
        ...counters,
        pollCount: counters.pollCount ?? 0,
        ganCostUsd: 3.00,
        noProgress: true,
      },
    };

    const result = derive(observed);

    // 实现后期望：terminal
    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe('no_progress_same_sha');
  });

  /**
   * T-04-c: MAX_FIX_ROUNDS=3 防止重复 fix（边界测试）
   */
  test('T-04-c: fixRound >= 3 → mark_failed(fix_cap)，不再是 20', () => {
    const logRows = [
      { hop: 1, action: 'spawn:generator', observed: {} },
      { hop: 2, action: 'spawn:generator-fix', observed: { trigger_sha: 'sha-0' } },
      { hop: 3, action: 'verdict:generator-fix-callback', observed: { pr_head_sha: 'sha-1' } },
      { hop: 4, action: 'spawn:generator-fix', observed: { trigger_sha: 'sha-1' } },
      { hop: 5, action: 'verdict:generator-fix-callback', observed: { pr_head_sha: 'sha-2' } },
      { hop: 6, action: 'spawn:generator-fix', observed: { trigger_sha: 'sha-2' } },
      { hop: 7, action: 'verdict:generator-fix-callback', observed: { pr_head_sha: 'sha-3' } },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    const observed = {
      run: { phase: 'generate', cost_usd: '5.00' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c1', row: {} },
      pr: { url: 'https://github.com/test/repo/pull/1', state: 'OPEN', merged: false, ci: 'fail', head_sha: 'sha-3' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: null,
      evaluateResult: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logRows,
      authCircuit: [],
      callbackResult: null,
      counters: { ...counters, pollCount: 0, ganCostUsd: 5.00 },
    };

    const result = derive(observed);

    // 实现后（MAX_FIX_ROUNDS=3）：fixRound=3 触发 fix_cap
    // 当前（先红）：MAX_FIX_ROUNDS=20，fixRound=3 < 20，会继续 generator-fix
    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe('fix_cap');
  });

  /**
   * T-04-d: d707 真实 replay 验证 hop 57 不再产生 generator-fix
   * 综合测试：judge FAIL + no-progress 熔断
   */
  test('T-04-d: d707 真实 replay hop 56 judge FAIL 不产生 spawn:generator-fix', () => {
    const logWithHop56 = [
      ...D707_REAL_DECISION_LOG,
      D707_HOP56_JUDGE_VERDICT,
    ];

    const counters = deriveCounters(logWithHop56, { proposeBranchMaxRn: 0 });
    const generatorFixHops = [];

    const observed = {
      run: { phase: 'judge', cost_usd: '5.00' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c-d707', row: {} },
      pr: {
        url: 'https://github.com/perfectuser21/cecelia/pull/4204',
        state: 'OPEN',
        merged: false,
        ci: 'pass',
        head_sha: D707_FINAL_SHA,
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 1,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: D707_FINAL_SHA, failure_class: null },
      evaluateResult: null,
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: D707_FINAL_SHA },
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logWithHop56,
      authCircuit: [],
      callbackResult: null,
      counters: { ...counters, pollCount: 0, ganCostUsd: 5.00 },
    };

    const result = derive(observed);

    if (result.action === 'spawn:generator-fix') {
      generatorFixHops.push(57);
    }

    // 验证：hop 57 不产生 generator-fix（真实 Bug fix 后）
    expect(generatorFixHops).toHaveLength(0);
    expect(result.action).not.toBe('spawn:generator-fix');
  });

  /**
   * T-04-e: d707 真实 hop 57-66 重复模式验证
   * 验证真实 Bug：10 次 spawn:generator-fix 同一 SHA，是 no-progress 熔断缺失导致
   */
  test('T-04-e: 真实 d707 hop 57-66 全部同 SHA（no-progress 应熔断）', () => {
    // 验证 fixture 本身：所有重复 fix hop 确实是同一 SHA
    const uniqueShas = new Set(
      D707_HOP57_66_REPEATED_FIX.map((h) => h.observed.pr.head_sha),
    );
    expect(uniqueShas.size).toBe(1);
    expect([...uniqueShas][0]).toBe(D707_FINAL_SHA);

    // 验证重复次数：10 次（hop 57-66）
    expect(D707_HOP57_66_REPEATED_FIX).toHaveLength(10);

    // 验证原因：全部 reason=judge_fail（trigger 是 judge 机械闸失败）
    const reasons = new Set(D707_HOP57_66_REPEATED_FIX.map((h) => h.detail.reason));
    expect(reasons.has('judge_fail')).toBe(true);
  });
});
