// Sprint 08221645-kernel-ef96e489 —— 冻结回归测试（真 derive，纯函数产物闸，无 DB）
//
// 覆盖父路：独立小路（无父路） —— 本 sprint 修的是 harness kernel derive 状态机的一类
// 「无出口人审死等」，不推进某条业务 Golden Path。
//
// 病根（r40 hop174/177 实证，案卷 08b3b2b5）：
//   diagnostic 类人审（由 callback_runner_failure_exhausted 等【非 merge_gate 原因】触发）
//   在人工 APPROVED 后，只在 orchestrator_decision_log 写下一条 verdict:human_review 行；
//   但 derive.js 的 latestUnconsumedAttemptResult 的 answeredCallbackHops 消费集合只认
//   verdict:context_answer / reopen_gan_contract 两类动作 —— 不认 diagnostic 人审批准。
//   于是触发人审的原 attempt callback 永远算「未消费」，attemptCallbackRoute 每跳重判仍
//   返回 wait:human_review（callback_runner_failure_exhausted）→ 无出口死等。
//
// 修复（本合同 CONTRACT IS LAW）：latestUnconsumedAttemptResult 把「diagnostic 类 APPROVED
//   且 pr_head_sha 与请求快照 head_sha 相符」的人审批准，视为消费掉触发它的那个 attempt
//   callback hop（复用 answeredCallbackHops 消费集合语义）→ attemptCallbackRoute 返回 null →
//   derive 回主链重试原动作，不再 wait:human_review。merge_gate 类批准语义逐字节不变。
//
// 禁 mock 边（v9.12）：本单改的边是 decisionLog → derive 决策（纯函数）。测试喂真实
//   decisionLog 行形状、调真 derive（不 stub attemptCallbackRoute / latestUnconsumedAttemptResult），
//   零 mock。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const SHA1 = 'a1b1c1d1e1f1a2b2c2d2e2f2a3b3c3d3e3f3a4b4';
const SHA2 = 'b9b9c9d9e9f9a8b8c8d8e8f8a7b7c7d7e7f7a6b6';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: { head_sha: SHA1, merged: false },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 40, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// attempt callback 行（复用生产形状：detail.hop = 派发跳，callbackDetail 读 row.detail）
const cb = (hop, detail) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: { hop: hop - 1, ...detail },
});

// diagnostic 类人审请求：3 次 runner_failure 后 attemptCallbackRoute 判 exhausted 落的 effect 行。
// review_reason=callback_runner_failure_exhausted → reviewClassForReason → DIAGNOSTIC。
const reviewRequest = (hop, headSha) => ({
  hop,
  action: 'effect:human_review_requested',
  observed: { pr: { head_sha: headSha }, review_reason: 'callback_runner_failure_exhausted' },
  detail: { review_reason: 'callback_runner_failure_exhausted' },
});

// 人审批准行（生产由 routes/harness-kernel-approvals.js 写入）：
//   detail.review_class = reviewClassForReason(request.review_reason)
const approval = (hop, { reviewClass, prHeadSha, requestHop, approved = true }) => ({
  hop,
  action: 'verdict:human_review',
  observed: { pr: { head_sha: prHeadSha }, review_request_hop: requestHop },
  detail: {
    verdict: approved ? 'APPROVED' : 'REJECTED',
    approved,
    review_class: reviewClass,
    pr_head_sha: prHeadSha,
    review_request_hop: requestHop,
  },
});

// 三连 runner_failure（evaluator）→ attemptCallbackRoute 判 exhausted 的前置日志。
// 触发 review 的 callback = hop 29（请求 hop 30 之前、最近的一条 attempt callback）。
function exhaustedRunnerFailureLog() {
  return [
    cb(21, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
    { hop: 22, action: 'spawn:evaluator', detail: { reason: 'callback_runner_failure_retry' } },
    cb(25, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
    { hop: 26, action: 'spawn:evaluator', detail: { reason: 'callback_runner_failure_retry' } },
    cb(29, { status: 'failed', failure_class: 'runner_failure', role: 'evaluator' }),
  ];
}

describe('diagnostic 类人审批准后 derive 消费该批准并重试原动作 [BEHAVIOR]', () => {
  it('B-01 diagnostic 人审 APPROVED（hop 匹配 + SHA 相符）→ 消费触发 callback，derive 回主链重试原动作，不再 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedRunnerFailureLog(),
        reviewRequest(30, SHA1),
        approval(31, { reviewClass: 'diagnostic', prHeadSha: SHA1, requestHop: 30 }),
      ],
    }));
    // 核心：不再死等人审
    expect(r.action).not.toBe('wait:human_review');
    expect(r.phase).not.toBe('review');
    expect(r.reason).not.toBe('callback_runner_failure_exhausted');
    // 回主链：触发 callback 已消费 → 主线按 head_sha 重判，重派原动作（evaluate 无 verdict → 重跑 evaluator）
    expect(r).toMatchObject({ phase: 'evaluate', action: 'spawn:evaluator' });
  });

  it('B-02 无对应 diagnostic APPROVED verdict（仅有 open review request）→ 触发 callback 未消费，derive 仍 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedRunnerFailureLog(),
        reviewRequest(30, SHA1),
        // 无 verdict:human_review 行
      ],
    }));
    expect(r).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_runner_failure_exhausted',
    });
  });

  it('B-03 diagnostic APPROVED 但 pr_head_sha 与请求快照 head_sha 不符 → 视为未消费，derive 仍 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedRunnerFailureLog(),
        reviewRequest(30, SHA1),
        approval(31, { reviewClass: 'diagnostic', prHeadSha: SHA2, requestHop: 30 }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_runner_failure_exhausted',
    });
  });

  it('B-04 merge_gate 类人审批准（review_class=merge_gate）不得被 diagnostic 消费路径吞掉 → 触发 callback 仍未消费，derive 仍 wait:human_review（merge_gate 语义不变）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedRunnerFailureLog(),
        reviewRequest(30, SHA1),
        approval(31, { reviewClass: 'merge_gate', prHeadSha: SHA1, requestHop: 30 }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'review',
      action: 'wait:human_review',
      reason: 'callback_runner_failure_exhausted',
    });
  });

  it('INV merge_gate 正路零回归：双 PASS + review_required + reviewApproved → merge_pr（merge_gate 放行路径逐字节不变）', () => {
    const identity = { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 's1' };
    const r = derive(baseObserved({
      run: { phase: 'merge' },
      contract: { approved: true, identity },
      pr: { head_sha: SHA1, merged: false },
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: SHA1, contract_identity: identity },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: SHA1, contract_identity: identity },
      reviewRequired: true,
      reviewApproved: true,
      decisionLog: [
        cb(29, { status: 'completed', role: 'judge' }),
      ],
    }));
    expect(r).toMatchObject({ phase: 'merge', action: 'merge_pr', reason: 'all_gates_passed' });
  });
});
