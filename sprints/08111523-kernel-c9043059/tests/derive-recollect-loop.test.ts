/**
 * 复现 Brain issue dbea513f（P0）：derive 取证死循环双修 的 TDD 红→绿回归。
 *
 * 真调纯函数 derive(observed)（禁 mock 被改的决策边），喂 run 06e4566c 决策序列，
 * 断言收敛动作。对齐 sprint PRD：packages/brain/src/orchestrator/derive.js 失败类路由。
 *
 * 注意：本文件直接 import 真实 derive.js（相对路径），不 mock 任何状态机边——
 * derive 是纯函数，唯一被改的「边」就是它自己的决策排序 + 护栏字段，必须真调。
 */
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

// 与 packages/brain/src/orchestrator/__tests__/derive.test.js 的 baseObserved 同构，
// 仅保留本 sprint 断言所需字段，其余取既有默认。
function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: {
      url: 'https://github.com/x/y/pull/1',
      state: 'OPEN',
      ci: 'pass',
      merged: false,
      head_sha: 'sha-new',
    },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: {
      hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0,
    },
    ...overrides,
  };
}

const evalPass = (hop) => ({
  hop, action: 'verdict:evaluate', detail: { verdict: 'PASS', pr_head_sha: 'sha-new' },
});
const judgeInsufficient = (hop) => ({
  hop,
  action: 'verdict:judge',
  detail: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'evidence_insufficient' },
});
// 生产实证：spawn:evaluator 落库 observed 快照顶层【缺】trigger_sha（只有 pr.head_sha）。
const recollectSpawnNoTriggerSha = (hop) => ({
  hop,
  action: 'spawn:evaluator',
  observed: { pr: { head_sha: 'sha-new' } },
  detail: { reason: 'judge_evidence_insufficient_recollect' },
});

describe('derive 取证死循环双修 [BEHAVIOR]', () => {
  // B-01：run 06e4566c 序列——judge FAIL evidence_insufficient → 重派 evaluator 补证
  //        → evaluator 返回【更晚于】最新 judge 的 evaluate PASS。下一动作必须派 judge
  //        复核新证据（evaluate_passed_awaiting_judge），而不是再次重派 evaluator。
  it('recollect 返回更晚的 evaluate PASS 后 派 judge 复核 而非再次 spawn:evaluator', () => {
    const o = baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'evidence_insufficient' },
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        evalPass(2),
        judgeInsufficient(3),
        recollectSpawnNoTriggerSha(4),
        evalPass(5), // 补证成功：晚于最新 judge(hop3) 的 evaluate PASS
      ],
    });
    const r = derive(o);
    expect(r.action).toBe('spawn:judge');
    expect(r.reason).toBe('evaluate_passed_awaiting_judge');
  });

  // B-02：guard 兜底——recollect 后 judge 重审仍 evidence_insufficient（最新 verdict 是 judge）。
  //        即便 spawn:evaluator 快照缺顶层 trigger_sha，护栏也必须用 observed.pr.head_sha 兜底
  //        匹配 currentHeadSha 而触发，落 WAIT_HUMAN_REVIEW，而非第三次 recollect。
  it('recollect 后仍 evidence_insufficient（trigger_sha 缺失，pr.head_sha 兜底）落人审 非第三次 recollect', () => {
    const o = baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'evidence_insufficient' },
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        evalPass(2),
        judgeInsufficient(3),
        recollectSpawnNoTriggerSha(4), // 缺 trigger_sha，仅 pr.head_sha
        evalPass(5), // 补证
        judgeInsufficient(6), // 重审仍不足，且晚于 hop5 evaluate
      ],
    });
    const r = derive(o);
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
  });

  // B-03：边界防过度触发——尚未 recollect 的首次 judge FAIL evidence_insufficient
  //        （evaluate 不晚于 judge）→ 仍走首次 spawn:evaluator 补证，不得误判 awaiting_judge。
  it('首次 evidence_insufficient（evaluate 不晚于 judge）仍走首次 spawn:evaluator 不误判 awaiting_judge', () => {
    const o = baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'evidence_insufficient' },
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        evalPass(2),
        judgeInsufficient(3), // 最新 verdict 是 judge，无更晚 evaluate
      ],
    });
    const r = derive(o);
    expect(r.action).toBe('spawn:evaluator');
    expect(r.reason).toBe('judge_evidence_insufficient_recollect');
  });

  // B-04：显式 trigger_sha 护栏路径不回归——recollect 快照【含】trigger_sha 时护栏照旧触发落人审。
  it('recollect 快照含 trigger_sha 且重审仍不足 落人审（显式路径不回归）', () => {
    const o = baseObserved({
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-new' },
      judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-new', failure_class: 'evidence_insufficient' },
      decisionLog: [
        { hop: 1, action: 'spawn:generator', observed: {} },
        evalPass(2),
        judgeInsufficient(3),
        { hop: 4, action: 'spawn:evaluator', observed: { trigger_sha: 'sha-new' }, detail: { reason: 'judge_evidence_insufficient_recollect' } },
        evalPass(5),
        judgeInsufficient(6),
      ],
    });
    const r = derive(o);
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('evidence_insufficient_after_recollect');
  });
});
