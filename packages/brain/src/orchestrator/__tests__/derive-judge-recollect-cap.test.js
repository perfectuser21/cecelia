import { describe, expect, it } from 'vitest';
import { derive } from '../derive.js';

// 2026-08-17 生产实证（run 6b0a3de1：17 轮 judge_evidence_insufficient_recollect，
// 每 ~95 秒一轮；run 6125d565 同病 14 轮）：derive 本来有"同一 SHA 只重新取证一次"的
// 止损闸，但它靠 observed 快照里的 trigger_sha / pr.head_sha 判定同一轮——本地候选流程
// （Kernel 常态，pr=null 且快照不记录 candidate.head_sha）两个字段都是 null，
// null === <当前SHA> 恒为 false → 闸永不生效 → 无限 recollect。
// 止损必须不依赖快照 SHA：直接数决策日志尾部连续的 recollect（其间没有新的
// generator/generator-fix 产出新候选），超过上限就转人审。
function observed(decisionLog, overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    pr: null,
    candidate: { branch: 'cp-route-api-x', head_sha: 'a'.repeat(40) },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    contract: { approved: true, identity: { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' } },
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'a'.repeat(40), contract_identity: { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' } },
    judgeVerdict: {
      verdict: 'FAIL',
      failure_class: 'evidence_insufficient',
      pr_head_sha: 'a'.repeat(40),
      contract_identity: { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' },
    },
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 60, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
    ...overrides,
  };
}

const judgeFail = (hop) => ({
  hop,
  action: 'verdict:judge',
  detail: {
    verdict: 'FAIL',
    failure_class: 'evidence_insufficient',
    pr_head_sha: 'a'.repeat(40),
  },
});
// 生产里的 recollect 派发行：observed 快照 pr=null（本地候选），没有 trigger_sha
const recollectSpawn = (hop) => ({
  hop,
  action: 'spawn:evaluator',
  observed: { pr: null, counters: { hops: hop } },
  detail: { reason: 'judge_evidence_insufficient_recollect' },
});

describe('judge evidence_insufficient recollect 止损（本地候选流程，pr=null）', () => {
  it('第一次证据不足 → 重派 Evaluator 取证', () => {
    const r = derive(observed([judgeFail(40)]));
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
  });

  it('已经重新取证过一次仍判证据不足 → 转人审，不再重派（pr=null 也必须生效）', () => {
    const r = derive(observed([
      judgeFail(40),
      recollectSpawn(41),
      judgeFail(46),
    ]));
    expect(r.phase).toBe('review');
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
  });

  it('新候选产出后（generator-fix 之后）重新计数，允许再取证一次', () => {
    const r = derive(observed([
      judgeFail(40),
      recollectSpawn(41),
      judgeFail(46),
      { hop: 47, action: 'spawn:generator-fix', observed: {}, detail: { reason: 'product_failure' } },
      judgeFail(60),
    ]));
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
  });
});
