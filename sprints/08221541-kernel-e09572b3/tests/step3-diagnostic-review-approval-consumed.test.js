// F1「工厂 · 开发闭环」步骤 3「造完真验」——边：diagnostic 类人审批准 ↔ derive 消费/重试
//
// r40 hop174 / r41 hop55 实证（案卷 08b3b2b5、5bfc1af9）：diagnostic 类人审
// （callback_semantic_refusal / callback_runner_failure_exhausted /
//  callback_runner_failure_route_unknown 等**非 merge_gate** 原因触发的 wait:human_review）
// 在 Commander approve 后，只写了一行 verdict:human_review(approved=true)，但
// derive 纯函数重判时 latestUnconsumedAttemptResult 仍把触发 review 的那次 attempt callback
// 当「未消费」→ attemptCallbackRoute 再次命中 → 重新返回同一个 wait:human_review。
// 批准对 derive 不可见 → 无出口人审死等，唯一解是 Commander 手工 append 消费行。
//
// 本 sprint 让批准被 ground-truth / derive 观测消费：diagnostic 类 APPROVED verdict
// 把「触发该 review 的 callback hop」记入 latestUnconsumedAttemptResult 的 answered 集合，
// attemptCallbackRoute 越过已消费 callback → derive 回主链重试原动作（前序 dispatch）。
//
// 按产物闸规矩写在边上：真 derive（不 stub attemptCallbackRoute / latestUnconsumedAttemptResult），
// 真 pure helper（不 mock decisionLog→derive、decisionLog→ground-truth 两条被改的边）。
import { describe, it, expect } from 'vitest';
import { derive, diagnosticApprovalConsumedCallbackHops } from '../../../packages/brain/src/orchestrator/derive.js';
import { openHumanReviewFromLog } from '../../../packages/brain/src/orchestrator/ground-truth.js';

const SHA = 'sha_abc1230000000000000000000000000000000000';
const OTHER_SHA = 'sha_def4560000000000000000000000000000000000';
const IDENTITY = { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' };

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: { head_sha: SHA, ci: 'pass', merged: false },
    candidate: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 30, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// 触发 review 的 attempt callback（blocked evaluator → callback_semantic_refusal → diagnostic）
const cb = (hop, detail) => ({ hop, action: 'verdict:attempt_callback', detail: { hop: hop - 1, ...detail } });
// diagnostic 人审请求（快照锚定 pr.head_sha）
const req = (hop, reason, sha) => ({
  hop,
  action: 'effect:human_review_requested',
  detail: { review_reason: reason },
  observed: { pr: { head_sha: sha } },
});
// Commander 批准（approved=true + review_class + review_request_hop + pr_head_sha 四字段）
const approve = (hop, d) => ({ hop, action: 'verdict:human_review', detail: { approved: true, ...d } });

// 标准死等场景：blocked evaluator callback(hop10) → 人审请求(hop11) → diagnostic APPROVED(hop12)
function diagnosticApprovedLog({ reviewClass = 'diagnostic', approveSha = SHA, reviewRequestHop = 11 } = {}) {
  return [
    cb(10, { status: 'blocked', role: 'evaluator' }),
    req(11, 'callback_semantic_refusal', SHA),
    approve(12, { review_class: reviewClass, review_request_hop: reviewRequestHop, pr_head_sha: approveSha }),
  ];
}

describe('F1 step3 — diagnostic 类人审批准后 derive 消费并重试原动作（无出口死等根除）', () => {
  it('B-01 diagnostic 批准被消费后 derive 越过 review 门回主链重试原动作（RED→GREEN）', () => {
    const r = derive(baseObserved({ decisionLog: diagnosticApprovedLog() }));
    // 死等根除：批准后 derive 不得再返回 wait:human_review
    expect(r.phase).not.toBe('review');
    expect(r.action).not.toBe('wait:human_review');
    // 回主链重试原动作 = 前序 evaluator dispatch（phase≠review）
    expect(r).toMatchObject({ phase: 'evaluate', action: 'spawn:evaluator' });
  });

  it('B-02 无对应 diagnostic APPROVED verdict 时 derive 仍 wait:human_review（负向①）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        cb(10, { status: 'blocked', role: 'evaluator' }),
        req(11, 'callback_semantic_refusal', SHA),
      ],
    }));
    expect(r).toMatchObject({ phase: 'review', action: 'wait:human_review', reason: 'callback_semantic_refusal' });
  });

  it('B-03 批准 pr_head_sha 与 review request 快照不符时不消费，仍 wait:human_review（负向② stale）', () => {
    const r = derive(baseObserved({
      decisionLog: diagnosticApprovedLog({ approveSha: OTHER_SHA }),
    }));
    expect(r).toMatchObject({ phase: 'review', action: 'wait:human_review', reason: 'callback_semantic_refusal' });
  });

  it('B-04 merge_gate 类批准语义不变，仍走 reviewApproved→merge_pr（回归，diagnostic 分支未污染）', () => {
    const r = derive(baseObserved({
      reviewRequired: true,
      reviewApproved: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: SHA, contract_identity: IDENTITY },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: SHA, contract_identity: IDENTITY },
      decisionLog: [],
    }));
    expect(r).toMatchObject({ phase: 'merge', action: 'merge_pr', reason: 'all_gates_passed' });
  });

  it('B-05 pure helper diagnosticApprovalConsumedCallbackHops 只对 diagnostic 有效批准收割触发 callback hop', () => {
    // diagnostic 有效批准 → 收割 hop 10（触发 review 的 callback）
    const consumed = [...diagnosticApprovalConsumedCallbackHops(diagnosticApprovedLog())].map(Number);
    expect(consumed).toContain(10);
    // merge_gate 类批准 → 不收割任何 diagnostic callback hop
    const mergeGate = [...diagnosticApprovalConsumedCallbackHops(diagnosticApprovedLog({ reviewClass: 'merge_gate' }))].map(Number);
    expect(mergeGate).not.toContain(10);
    // review_request_hop 不指向存在的 open review request → 不收割（hop 不匹配不消费）
    const hopMismatch = [...diagnosticApprovalConsumedCallbackHops(diagnosticApprovedLog({ reviewRequestHop: 99 }))].map(Number);
    expect(hopMismatch).not.toContain(10);
    // SHA 不符 → 不收割
    const staleSha = [...diagnosticApprovalConsumedCallbackHops(diagnosticApprovedLog({ approveSha: OTHER_SHA }))].map(Number);
    expect(staleSha).not.toContain(10);
  });

  it('B-06 ground-truth openHumanReviewFromLog 消费后置 false、未消费/无批准仍 true', () => {
    // 有效 diagnostic 批准消费 → open_human_review=false
    expect(openHumanReviewFromLog(diagnosticApprovedLog())).toBe(false);
    // 无批准 → 人审仍 open
    expect(openHumanReviewFromLog([
      cb(10, { status: 'blocked', role: 'evaluator' }),
      req(11, 'callback_semantic_refusal', SHA),
    ])).toBe(true);
    // stale SHA 批准不消费 → 仍 open
    expect(openHumanReviewFromLog(diagnosticApprovedLog({ approveSha: OTHER_SHA }))).toBe(true);
  });
});
