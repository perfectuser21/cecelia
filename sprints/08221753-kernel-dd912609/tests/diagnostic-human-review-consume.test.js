/**
 * 冻结回归测试 — diagnostic 类人审批准后 derive 消费该批准并重试原动作。
 *
 * 覆盖父路: 独立小路（无父路）—— harness kernel derive 纯函数路由。
 *
 * Golden Path（PRD sprints/08221753-kernel-dd912609/sprint-prd.md）:
 *   diagnostic 人审被批准 → ground-truth 观测消费该批准 → derive 回主链重试原动作，脱离死等。
 *
 * 背景 bug（r40 hop174/177 实证）: 由非 merge_gate 原因（callback_runner_failure_exhausted /
 * callback_semantic_refusal）触发的 wait:human_review 被人 approve 后，derive 读不到消费信号，
 * 仍计算出 wait:human_review → 无出口死等。本测试冻结「批准后消费并重试原动作」的正确行为，
 * 并守两条负向（无批准 / stale 批准仍 wait）与一条不变量（merge_gate 语义不受影响）。
 *
 * 纯函数、零 I/O、决定论重放：只喂 observed（含 decisionLog），断言 derive 输出。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CONTRACT_IDENTITY = Object.freeze({
  contract_id: '99999999-9999-4999-8999-999999999999',
  manifest_sha256: '9'.repeat(64),
  source_revision: '8'.repeat(64),
});

const HEAD_SHA = 'sha-new';

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: CONTRACT_IDENTITY },
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

// 三次 runner_failure 后 derive 会输出 callback_runner_failure_exhausted → wait:human_review（diagnostic 类）。
// 触发它的 callback hop = 9（最后一次 exhausted 的 callback）。
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

describe('diagnostic 人审消费', () => {
  it('diagnostic 人审批准后 derive 消费该批准并重试原动作，不再 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedChain(),
        diagnosticReviewRequest(10),
        humanApproval(11),
      ],
    }));
    // 消费后回主链重试原动作（原 callback role=evaluator → 重试 evaluate 相位），绝不再是死等人审。
    expect(r.action).not.toBe('wait:human_review');
    expect(r.phase).toBe('evaluate');
  });

  it('无批准 diagnostic review 无对应 APPROVED verdict → 仍 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedChain(),
        diagnosticReviewRequest(10),
        // 无 verdict:human_review 批准行
      ],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_runner_failure_exhausted');
  });

  it('stale 批准 pr_head_sha 与请求不符 → 仍 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedChain(),
        diagnosticReviewRequest(10, HEAD_SHA),
        humanApproval(11, { pr_head_sha: 'sha-stale-old' }),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
  });

  it('merge_gate 类批准不触发 diagnostic 消费 → 语义不变仍 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...exhaustedChain(),
        diagnosticReviewRequest(10),
        humanApproval(11, { review_class: 'merge_gate' }),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
  });
});
