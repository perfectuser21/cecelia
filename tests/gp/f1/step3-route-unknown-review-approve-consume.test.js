// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：route_unknown 人审批准 ↔ derive 候选头锚消费
//
// r70 (run 919d957f) 生产实证：commander attempt lease 过期被 reconcile
// （effect:expired_attempt_reconciled, failure_class=infrastructure_blocked），
// commander 不在 infrastructureRetryForCallback 重试表 → wait:human_review
// (callback_infrastructure_route_unknown)。人 approve 后（verdict:human_review
// APPROVED, review_class=diagnostic）批准永不被消费，run 无出口死等 6h+：
// ① derive 的 route_unknown 决策对象不带 callbackHop → loop 落
//    effect:human_review_requested 请求行时 detail 无 callback_hop →
//    diagnosticConsumedCallbackHops 第一锚必败；
// ② 本地候选（发布前 pr=null）请求行 observed.pr=null，消费端第二锚
//    （request.observed.pr.head_sha === currentHeadSha）必败——candidate_head_sha
//    锚（r55 #5048 已写进 detail）没有被消费端认。
//
// 修法（#5058 本批）：
// a) derive attemptCallbackRoute 的 route_unknown 分支决策对象带 callbackHop: Number(row.hop)；
// b) loop 落 human_review_requested 请求行时 detail 落 callback_hop（decision.callbackHop）；
// c) diagnosticConsumedCallbackHops 请求行头锚支持 detail.candidate_head_sha 回落；
// d) attemptCallbackRoute/derive 传入消费函数的 currentHeadSha 支持候选头回落。
//
// r75 升级（本 sprint）：commander infra 过期纳入有界（上限 5）重试。故 route_unknown 前提
// 从「单条 expired」升级为「已达重试上限（5 条 expired，末条 hop=112）」——此时才 wait+callbackHop；
// 人 approve 消费 hop112 后，下一条未消费行为 hop109（序号 4 < 5）→ 不再挂人审，run 继续。
// 消费闭环断言语义不变（达上限 wait + callbackHop，approve 后消费出口）；新增一条 r75 子用例
// 覆盖「未达上限（单条 commander 过期，<5）→ 不再挂人审」。
//
// 按 GP 产物闸规矩写在边上：真 derive，不 mock 被改的边。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CAND_SHA = 'df13ca81519019e790d6387229f497ba78071cfc';
const IDENTITY = { contract_id: 'c70', manifest_sha256: 'm70', source_revision: 'r70' };

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: null,
    candidate: { branch: 'cp-route-api-11f8fc19', head_sha: CAND_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CAND_SHA, contract_identity: IDENTITY },
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 115, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// commander attempt lease 过期被 reconcile（r70 hop112 实录形状）
const expiredCommanderReconciled = (hop) => ({
  hop,
  action: 'effect:expired_attempt_reconciled',
  detail: {
    role: 'commander',
    status: 'failed',
    failure_class: 'infrastructure_blocked',
    signature: 'worker_attempt_replacement_required_after_lease',
    attempt_id: `33333333-3333-4333-8333-${String(hop).padStart(12, '0')}`,
  },
});

// r75：route_unknown 前提 = 已达重试上限（5 条 commander infra expired，末条 hop=112）。
const CAP_EXPIRED_HOPS = [103, 105, 107, 109, 112];
const capReachedChain = () => ([
  { hop: 101, action: 'spawn:commander', observed: {} },
  ...CAP_EXPIRED_HOPS.map((hop) => expiredCommanderReconciled(hop)),
]);

// 本地候选请求行：observed.pr=null，detail 带 candidate_head_sha（#5048）+ callback_hop（#5058 修法 a/b）
const localCandidateReviewRequest = (hop, patch = {}) => ({
  hop,
  action: 'effect:human_review_requested',
  observed: { pr: null },
  detail: {
    review_reason: 'callback_infrastructure_route_unknown',
    candidate_head_sha: CAND_SHA,
    callback_hop: 112,
    ...patch,
  },
});

const humanApproval = (hop, patch = {}) => ({
  hop,
  action: 'verdict:human_review',
  detail: {
    approved: true,
    review_class: 'diagnostic',
    pr_head_sha: CAND_SHA,
    review_request_hop: hop - 1,
    ...patch,
  },
});

describe('F1 step3 — route_unknown 人审批准候选头锚消费（r70 案卷 · r75 有界升级）', () => {
  it('达重试上限（5 条 expired）route_unknown 决策对象带 callbackHop=112（loop 落盘请求行锚的来源）', () => {
    const r = derive(baseObserved({ decisionLog: capReachedChain() }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
    expect(r.callbackHop).toBe(112);
  });

  it('r75 未达上限（单条 commander 过期，<5）→ 不再挂人审（改由 coordinator 重派）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        { hop: 101, action: 'spawn:commander', observed: {} },
        expiredCommanderReconciled(112),
      ],
    }));
    expect(r.action).not.toBe('wait:human_review');
    expect(r.reason).not.toBe('callback_infrastructure_route_unknown');
  });

  it('本地候选（pr=null）批准 → 候选头锚双匹配消费，不再 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [...capReachedChain(), localCandidateReviewRequest(114), humanApproval(115, { review_request_hop: 114 })],
    }));
    expect(r.action).not.toBe('wait:human_review');
  });

  it('负向：无批准 → 仍 wait:human_review（fail-closed）', () => {
    const r = derive(baseObserved({
      decisionLog: [...capReachedChain(), localCandidateReviewRequest(114)],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
  });

  it('负向：批准的 pr_head_sha 与候选头不符（stale 批准）→ 不消费仍 wait', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...capReachedChain(),
        localCandidateReviewRequest(114),
        humanApproval(115, { review_request_hop: 114, pr_head_sha: 'a'.repeat(40) }),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
  });

  it('负向：请求行既无 callback_hop 也无候选头锚 → 不消费仍 wait（不误放历史坏行）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...capReachedChain(),
        localCandidateReviewRequest(114, { callback_hop: undefined, candidate_head_sha: undefined }),
        humanApproval(115, { review_request_hop: 114 }),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
  });
});
