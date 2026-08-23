/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * 第 28 批（issue 29826d18 + 1f43531b，r57/r59 案卷）四件套之 derive 三件：
 *
 * ① r57 实证：容量闸 BLOCKED 的 recollect 派发（result:dispatch status=BLOCKED
 *    锚定该 dispatch_hop）被止损闸当"已取证一次"——真取证零次就停人审。
 *    修复：BLOCKED 的派发行不计入 recollect 消耗。
 * ② r57 实证：批准消费后直通 publish 撞 publisher 授权链
 *    （publisher_judge_authority_missing → assembly_fault run terminal）。
 *    修复：approve 语义=解锁一次重取证——路由 spawn:evaluator
 *    reason=recollect_human_approved_retry，授权链不绕；取证 PASS→judge PASS
 *    →自然发布。批准只解锁一次：批准后已重派过且 judge 再 FAIL → 再次人审。
 */
import { describe, expect, it } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const CANDIDATE_SHA = 'a'.repeat(40);
const IDENTITY = { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' };

function observed(decisionLog, overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    pr: null,
    candidate: { branch: 'cp-route-api-b28', head_sha: CANDIDATE_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:judge' },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    contract: { approved: true, identity: IDENTITY },
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: CANDIDATE_SHA, contract_identity: IDENTITY },
    judgeVerdict: {
      verdict: 'FAIL',
      failure_class: 'evidence_insufficient',
      pr_head_sha: CANDIDATE_SHA,
      contract_identity: IDENTITY,
    },
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 40, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
    ...overrides,
  };
}

const recollectSpawn = (hop) => ({
  hop,
  action: 'spawn:evaluator',
  observed: { pr: null },
  detail: { reason: 'judge_evidence_insufficient_recollect' },
});
const blockedDispatch = (hop, dispatchHop) => ({
  hop,
  action: 'result:dispatch',
  detail: { status: 'BLOCKED', dispatch_hop: dispatchHop, reason_code: 'fact_snapshot_stale' },
});
const launched = (hop) => ({ hop, action: 'effect:attempt_launched', detail: {} });
const reviewRequest = (hop) => ({
  hop,
  action: 'effect:human_review_requested',
  observed: { pr: null },
  detail: {
    review_reason: 'evidence_insufficient_after_recollect',
    candidate_head_sha: CANDIDATE_SHA,
    dispatch_hop: hop - 1,
  },
});
const reviewApproved = (hop, requestHop) => ({
  hop,
  action: 'verdict:human_review',
  observed: { pr: null },
  detail: {
    verdict: 'APPROVED',
    approved: true,
    review_class: 'diagnostic',
    pr_head_sha: CANDIDATE_SHA,
    review_request_hop: requestHop,
    approved_by: 'alex',
  },
});

describe('① BLOCKED 派发不消耗 recollect 机会（r57 案卷）', () => {
  it('唯一一次 recollect 派发被 BLOCKED（没真跑）→ 仍允许重派 recollect，不停人审', () => {
    const r = derive(observed([
      recollectSpawn(22),
      blockedDispatch(23, 22),
    ]));
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
  });

  it('负向：真跑过的 recollect（attempt_launched 在案）仍算已取证 → 停人审', () => {
    const r = derive(observed([
      recollectSpawn(22),
      launched(23),
    ]));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
  });
});

describe('② approve 语义=解锁一次重取证，不直通 publish（r57 assembly_fault 案卷）', () => {
  it('批准在案且批准后未重派 → 路由 spawn:evaluator(recollect_human_approved_retry)，不是 publish', () => {
    const r = derive(observed([
      recollectSpawn(22),
      launched(23),
      reviewRequest(31),
      reviewApproved(32, 31),
    ]));
    expect(r.phase).toBe('evaluate');
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('recollect_human_approved_retry');
  });

  it('批准只解锁一次：批准后已重派过且 judge 再 FAIL → 再次 wait:human_review', () => {
    const r = derive(observed([
      recollectSpawn(22),
      launched(23),
      reviewRequest(31),
      reviewApproved(32, 31),
      { hop: 33, action: 'spawn:evaluator', observed: { pr: null }, detail: { reason: 'recollect_human_approved_retry' } },
      launched(34),
    ]));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
  });

  it('负向：无批准 → 仍 wait:human_review（闸语义不回退）', () => {
    const r = derive(observed([
      recollectSpawn(22),
      launched(23),
      reviewRequest(31),
    ]));
    expect(r.action).toBe('wait:human_review');
  });
});
