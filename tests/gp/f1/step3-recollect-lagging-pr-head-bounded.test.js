/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * r54 生产实证（run 9487158a，2026-08-23）：候选流（unpublishedCandidate）下
 * derive 用候选头当 currentHeadSha，但 spawn:evaluator 落库快照只记录了滞后的
 * PR 头（buildSnapshot 无 candidate 字段）。recollect 止损闸要求「快照 SHA 匹配
 * currentHeadSha 或快照无头」才计数——快照有头但是错的头 → 既不匹配也不缺失 →
 * 闸恒 false → judge_evidence_insufficient_recollect 无限循环，实测烧掉 9 个
 * Evaluator 才被人工击杀。
 *
 * 修复语义（回归 docstring 原意）：本轮候选内（自最近 generator/generator-fix
 * 行以来）只要出现过 recollect 派发，就算已取证过——不依赖快照 SHA 锚定。
 * 能进 evidence_insufficient 分支的 verdict 必然锚定 currentHeadSha，候选换头
 * 必经 generator 行重置计数，故纯轮内计数不会误伤合法场景。
 */
import { describe, expect, it } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { __test__ as loopTest } from '../../../packages/brain/src/orchestrator/loop.js';

const CANDIDATE_SHA = 'b'.repeat(40); // Runner 验证的本地候选头（真验收对象）
const STALE_PR_SHA = 'c'.repeat(40); // 滞后的远端 PR 头（fix 后未发布）
const IDENTITY = { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' };

function observed(decisionLog, overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    // r54 形态：PR 存在且 CI fail（指向旧头），候选已被 generator-fix 推进
    pr: {
      url: 'https://github.com/perfectuser21/cecelia/pull/5034',
      state: 'OPEN',
      ci: 'fail',
      merged: false,
      head_sha: STALE_PR_SHA,
      failed_checks: ['ci-passed'],
    },
    candidate: { branch: 'cp-route-api-r54', head_sha: CANDIDATE_SHA },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:judge' },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    contract: { approved: true, identity: IDENTITY },
    evaluateVerdict: {
      verdict: 'FAIL',
      failure_class: 'product_failure',
      pr_head_sha: CANDIDATE_SHA,
      contract_identity: IDENTITY,
    },
    judgeVerdict: {
      verdict: 'FAIL',
      failure_class: 'evidence_insufficient',
      pr_head_sha: CANDIDATE_SHA,
      contract_identity: IDENTITY,
    },
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 60, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
    ...overrides,
  };
}

// r54 生产落库形态：快照带滞后 PR 头，没有 trigger_sha / candidate 字段
const recollectSpawnWithStalePrHead = (hop) => ({
  hop,
  action: 'spawn:evaluator',
  observed: { pr: { head_sha: STALE_PR_SHA, ci: 'fail' }, counters: { hops: hop } },
  detail: { reason: 'judge_evidence_insufficient_recollect' },
});

const generatorFix = (hop) => ({
  hop,
  action: 'spawn:generator-fix',
  observed: { trigger_sha: STALE_PR_SHA, failure_class: 'product_failure' },
  detail: { reason: 'ci_fail' },
});

const evaluateFail = (hop) => ({
  hop,
  action: 'verdict:evaluate',
  detail: { verdict: 'FAIL', failure_class: 'product_failure', pr_head_sha: CANDIDATE_SHA },
});

describe('recollect 止损闸不依赖快照 SHA 锚定（r54 滞后 PR 头变体）', () => {
  it('快照记录滞后 PR 头（≠候选头）时，已 recollect 过一次仍判证据不足 → 转人审，不再重派', () => {
    const r = derive(observed([
      generatorFix(41),
      recollectSpawnWithStalePrHead(53),
      evaluateFail(56),
    ]));
    expect(r.phase).toBe('review');
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
  });

  it('负向：本轮候选还没 recollect 过 → 首次仍放行重派 Evaluator', () => {
    const r = derive(observed([generatorFix(41), evaluateFail(48)]));
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
  });

  it('负向：generator-fix 产出新候选后重置计数，允许再取证一次', () => {
    const r = derive(observed([
      generatorFix(41),
      recollectSpawnWithStalePrHead(53),
      evaluateFail(56),
      generatorFix(57),
      evaluateFail(64),
    ]));
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
  });
});

describe('recollect 派发快照记录派发时真实验收头（候选优先）', () => {
  it('buildSnapshot 对 spawn:evaluator recollect 写 trigger_sha=候选头，供事后排查锚定', () => {
    const snapshot = loopTest.buildSnapshot(
      observed([]),
      { hops: 60 },
      'spawn:evaluator',
      'judge_evidence_insufficient_recollect',
    );
    expect(snapshot.trigger_sha).toBe(CANDIDATE_SHA);
  });
});
