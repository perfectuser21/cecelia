// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：global_loop_breaker 批准消费 ↔ 本地候选人审停表
//
// r76 (run 35bddb0e) 双实证：
// ① global_loop_breaker 人审（熔断兜底，决策 e3afa828）被 APPROVED 后没有任何消费
//    逻辑——derive 重放时 streak 仍 ≥5 继续算 wait:human_review，批准形同虚设，
//    run 空等直到 deadline（第 3 个批准出口盲区：semantic_refusal 族 r40 修、
//    route_unknown 族 #5058 修、breaker 族漏）。
// ② 人审挂起停表 deadlinePaused 依赖 observed.pr.head_sha 与请求行 observed.pr.head_sha
//    ——本地候选（发布前 pr=null）双双为 null → 不停表 → 挂人审 6h 烧穿
//    automation_deadline_exceeded（r75/r76 连续撞钟的共同深因，"人审 deadline
//    不冻结"老 issue 的精确定位）。
//
// 修法（本批）：
// a) globalLoopBreakerTripped 增加批准重置点：扫描遇到 approved=true 且
//    pr_head_sha 命中当前头（候选头回落）的 verdict:human_review 行 → streak 归零
//    （批准语义=放行一次原派发；批准后同因再攒满 5 次 → 再熔断，fail-closed 不变）。
// b) 停表判定抽纯函数并支持候选头：请求行头锚回落 detail.candidate_head_sha，
//    当前头回落 observed.candidate.head_sha。
//
// 真 import derive 与 loop.__test__（被改的边），不 mock。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { __test__ as loopTest } from '../../../packages/brain/src/orchestrator/loop.js';

const CAND_SHA = '1d44883be30b3e7019a262489cfa9d453838f5ab';
const IDENTITY = { contract_id: 'c76', manifest_sha256: 'm76', source_revision: 'r76' };

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: null,
    candidate: { branch: 'cp-route-api-ec858db3', head_sha: CAND_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CAND_SHA, contract_identity: IDENTITY },
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 140, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// 5 连 spawn:judge 同 reason（evaluate PASS 等 judge）→ 熔断阈值
const judgeSpawn = (hop) => ({
  hop,
  action: 'spawn:judge',
  detail: { reason: 'evaluate_passed_awaiting_judge' },
});
const breakerChain = () => [110, 112, 114, 116, 118].map(judgeSpawn);

const breakerReviewRequest = (hop, patch = {}) => ({
  hop,
  action: 'effect:human_review_requested',
  observed: { pr: null },
  detail: {
    review_reason: 'global_loop_breaker',
    candidate_head_sha: CAND_SHA,
    ...patch,
  },
});

const breakerApproval = (hop, patch = {}) => ({
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

describe('F1 step3 — global_loop_breaker 批准消费（r76 案卷①）', () => {
  it('现状熔断：5 连同因 spawn → wait:human_review(global_loop_breaker)', () => {
    const r = derive(baseObserved({ decisionLog: breakerChain() }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('global_loop_breaker');
  });

  it('批准（候选头命中）→ 放行一次原派发，不再 wait', () => {
    const r = derive(baseObserved({
      decisionLog: [...breakerChain(), breakerReviewRequest(120), breakerApproval(121, { review_request_hop: 120 })],
    }));
    expect(r.action).not.toBe('wait:human_review');
    expect(r.action).toBe('spawn:judge');
  });

  it('负向：批准 pr_head_sha 与候选头不符（stale）→ 不消费仍熔断 wait', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...breakerChain(),
        breakerReviewRequest(120),
        breakerApproval(121, { review_request_hop: 120, pr_head_sha: 'a'.repeat(40) }),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('global_loop_breaker');
  });

  it('负向：批准后同因再攒满 5 次 → 再次熔断（批准只放行一轮）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        ...breakerChain(),
        breakerReviewRequest(120),
        breakerApproval(121, { review_request_hop: 120 }),
        judgeSpawn(122), judgeSpawn(124), judgeSpawn(126), judgeSpawn(128), judgeSpawn(130),
      ],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('global_loop_breaker');
  });
});

describe('F1 step3 — 本地候选人审停表（r76 案卷②）', () => {
  it('本地候选（pr=null）挂人审：请求行候选头锚命中 → 停表', () => {
    const paused = loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'wait:human_review',
      hasOpenHumanReview: true,
      reviewHeadSha: CAND_SHA,
      currentHeadSha: CAND_SHA,
    });
    expect(paused).toBe(true);
  });

  it('请求行头锚与当前头不符但仍在等人 → 停表（第 48 批翻案 r83：等人期间时钟不杀人）', () => {
    const paused = loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'wait:human_review',
      hasOpenHumanReview: true,
      reviewHeadSha: 'a'.repeat(40),
      currentHeadSha: CAND_SHA,
    });
    expect(paused).toBe(true);
  });

  it('负向：无开放人审 → 不停表', () => {
    const paused = loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'wait:human_review',
      hasOpenHumanReview: false,
      reviewHeadSha: CAND_SHA,
      currentHeadSha: CAND_SHA,
    });
    expect(paused).toBe(false);
  });

  it('负向：当前头缺失（无 pr 无 candidate）→ 不停表（fail-closed）', () => {
    const paused = loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'wait:human_review',
      hasOpenHumanReview: true,
      reviewHeadSha: null,
      currentHeadSha: null,
    });
    expect(paused).toBe(false);
  });
});
