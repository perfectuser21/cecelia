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
// 修法（本批）：
// a) derive attemptCallbackRoute 的三个 route_unknown 分支决策对象带
//    callbackHop: Number(row.hop)（照 contract_fault_appeal 先例）；
// b) loop 落 human_review_requested 请求行时 detail 落 callback_hop（decision.callbackHop）；
// c) diagnosticConsumedCallbackHops 请求行头锚支持 detail.candidate_head_sha 回落；
// d) attemptCallbackRoute/derive 传入消费函数的 currentHeadSha 支持候选头回落。
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

// r72 迁移（#5058 消费锚在新语义下保留）：单条 commander 过期不再挂人审（根因已修，
// 由 derive 降级续跑）。要让 route_unknown 人审重新成立，须复刻「同 run 内 commander
// infrastructure 失败累计达上限（COMMANDER_INFRA_RETRY_CAP=5）」的 production 形状——
// 交替 spawn:commander / expired_attempt_reconciled ×5，最新收割行 hop=110 即触发人审的
// callback hop 锚。本文件其余批准消费断言语义逐字保留（仅锚点随新链尾 hop 从 112→110）。
const routeUnknownChain = () => ([
  { hop: 101, action: 'spawn:commander', observed: {} },
  expiredCommanderReconciled(102),
  { hop: 103, action: 'spawn:commander', observed: {} },
  expiredCommanderReconciled(104),
  { hop: 105, action: 'spawn:commander', observed: {} },
  expiredCommanderReconciled(106),
  { hop: 107, action: 'spawn:commander', observed: {} },
  expiredCommanderReconciled(108),
  { hop: 109, action: 'spawn:commander', observed: {} },
  expiredCommanderReconciled(110),
]);

// 本地候选请求行：observed.pr=null，detail 带 candidate_head_sha（#5048）+ callback_hop（本批修法 a/b）
// r72：callback_hop 锚随新链尾从 112→110（触发人审的最新 commander 收割行 hop）。
const localCandidateReviewRequest = (hop, patch = {}) => ({
  hop,
  action: 'effect:human_review_requested',
  observed: { pr: null },
  detail: {
    review_reason: 'callback_infrastructure_route_unknown',
    candidate_head_sha: CAND_SHA,
    callback_hop: 110,
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

describe('F1 step3 — route_unknown 人审批准候选头锚消费（r70 案卷）', () => {
  it('route_unknown 决策对象带 callbackHop（loop 落盘请求行锚的来源）', () => {
    const r = derive(baseObserved({ decisionLog: routeUnknownChain() }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
    expect(r.callbackHop).toBe(110);
  });

  it('本地候选（pr=null）批准 → 候选头锚双匹配消费，不再 wait:human_review', () => {
    const r = derive(baseObserved({
      decisionLog: [...routeUnknownChain(), localCandidateReviewRequest(114), humanApproval(115, { review_request_hop: 114 })],
    }));
    expect(r.action).not.toBe('wait:human_review');
  });

  it('负向：无批准 → 仍 wait:human_review（fail-closed）', () => {
    const r = derive(baseObserved({
      decisionLog: [...routeUnknownChain(), localCandidateReviewRequest(114)],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
  });

  it('负向：批准的 pr_head_sha 与候选头不符（stale 批准）→ 不消费仍 wait', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...routeUnknownChain(),
        localCandidateReviewRequest(114),
        humanApproval(115, { review_request_hop: 114, pr_head_sha: 'a'.repeat(40) }),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
  });

  it('负向：请求行既无 callback_hop 也无候选头锚 → 不消费仍 wait（不误放历史坏行）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...routeUnknownChain(),
        localCandidateReviewRequest(114, { callback_hop: undefined, candidate_head_sha: undefined }),
        humanApproval(115, { review_request_hop: 114 }),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
  });
});
