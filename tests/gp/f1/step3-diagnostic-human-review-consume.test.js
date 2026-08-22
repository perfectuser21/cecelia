// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：diagnostic 人审批准 ↔ derive 消费/重试路由
//
// r40 hop174/177 生产实证：由非 merge_gate 原因（callback_runner_failure_exhausted）触发的
// diagnostic 类 wait:human_review 被人 approve 后，observed 无字段承载「这条 diagnostic 审已批准」，
// derive 纯函数重放读不到消费信号 → 仍算 wait:human_review → run 无出口死等。
//
// 修法（本 sprint）：把「触发该 review 的 callback hop」（记在 effect:human_review_requested 的
// detail.callback_hop）在双锚定（review_class≠merge_gate + review_request_hop 命中 + pr_head_sha 匹配）
// 批准生效后并入 answeredCallbackHops，令 latestUnconsumedAttemptResult 跳过该 callback → derive 回主链
// 重试原动作（evaluator role → evaluate 相位）。
//
// 按 GP 产物闸规矩写在边上：真 derive（不 vi.mock attemptCallbackRoute / latestUnconsumedAttemptResult）。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const HEAD_SHA = 'sha-new';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: { url: 'https://github.com/x/y/pull/1', state: 'OPEN', ci: 'pass', merged: false, head_sha: HEAD_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 12, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

const runnerFailure = (hop) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: {
    run_id: '11111111-1111-4111-8111-111111111111',
    attempt_id: `22222222-2222-4222-8222-${String(hop).padStart(12, '0')}`,
    lease_generation: 0,
    role: 'evaluator',
    hop: hop - 1,
    status: 'failed',
    failure_class: 'runner_failure',
    artifacts: [],
  },
});

// 三次 runner_failure exhausted → diagnostic 类 wait:human_review，触发 callback hop = 9。
const exhaustedChain = () => ([
  { hop: 1, action: 'spawn:evaluator', observed: {} },
  runnerFailure(3),
  { hop: 4, action: 'spawn:evaluator', observed: {} },
  runnerFailure(6),
  { hop: 7, action: 'spawn:evaluator', observed: {} },
  runnerFailure(9),
]);

const diagnosticReviewRequest = (hop, headSha = HEAD_SHA) => ({
  hop,
  action: 'effect:human_review_requested',
  observed: { pr: { head_sha: headSha } },
  detail: { review_reason: 'callback_runner_failure_exhausted', callback_hop: 9 },
});

const humanApproval = (hop, patch = {}) => ({
  hop,
  action: 'verdict:human_review',
  detail: {
    approved: true,
    review_class: 'diagnostic',
    pr_head_sha: HEAD_SHA,
    review_request_hop: hop - 1,
    ...patch,
  },
});

describe('F1 step3 — diagnostic 人审批准消费，脱离无出口死等', () => {
  it('批准（hop+sha 双匹配）→ 消费并回主链重试原动作，不再 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [...exhaustedChain(), diagnosticReviewRequest(10), humanApproval(11)],
    }));
    expect(r.action).not.toBe('wait:human_review');
    expect(r.phase).toBe('evaluate');
  });

  it('负向：无批准 → 仍 wait:human_review（不误放行）', () => {
    const r = derive(baseObserved({
      decisionLog: [...exhaustedChain(), diagnosticReviewRequest(10)],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_runner_failure_exhausted');
  });

  it('负向：merge_gate 类批准不触发 diagnostic 消费 → 语义不变仍 wait', () => {
    const r = derive(baseObserved({
      decisionLog: [...exhaustedChain(), diagnosticReviewRequest(10), humanApproval(11, { review_class: 'merge_gate' })],
    }));
    expect(r.action).toBe('wait:human_review');
  });
});
