/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * 决策 e3afa828：全局熔断器。r54（9× judge_evidence_insufficient_recollect）、
 * 2026-08-17 6b0a3de1（17 轮）、6125d565（14 轮）同族实证：每种死循环变体都靠
 * 事后修一个专用闸，未知变体总能烧到人来发现。机械兜底缺位。
 *
 * 修复：derive 顶层通用熔断——同一 spawn action + 同一 detail.reason 已连续
 * 出现 ≥5 次（期间无 generator/generator-fix 产新候选重置）时，第 6 次派发
 * 被拦截为 wait:human_review（reason=global_loop_breaker），不管专用闸是否
 * 存在或是否被变体绕过。纯 decisionLog 行计数，可重放。
 */
import { describe, expect, it } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const HEAD = 'd'.repeat(40);
const IDENTITY = { contract_id: 'c1', manifest_sha256: 'm1', source_revision: 'r1' };

// 构造一个会让 derive 推导出 spawn:judge(evaluate_completed_awaiting_judge) 的
// observed：evaluate FAIL 在案而 judge verdict 缺失 → 4b 永远想再派 judge。
// 用它模拟"某个未知机制缺陷让同一派发理由反复出现"的通用场景。
function observed(decisionLog) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    pr: null,
    candidate: { branch: 'cp-route-api-loop', head_sha: HEAD },
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false, action: 'spawn:evaluator' },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    contract: { approved: true, identity: IDENTITY },
    evaluateVerdict: { verdict: 'FAIL', failure_class: 'product_failure', pr_head_sha: HEAD, contract_identity: IDENTITY },
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 60, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
  };
}

const judgeSpawn = (hop) => ({
  hop,
  action: 'spawn:judge',
  observed: { pr: null },
  detail: { reason: 'evaluate_completed_awaiting_judge' },
});
const callback = (hop) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: { status: 'completed' },
});

function repeatedSpawns(count) {
  const rows = [];
  let hop = 10;
  for (let i = 0; i < count; i++) {
    rows.push(judgeSpawn(hop));
    rows.push(callback(hop + 1));
    hop += 2;
  }
  return rows;
}

describe('全局熔断器：同 action+同 reason 连续 ≥5 次强制人审', () => {
  it('已连续 5 次同派发 → 第 6 次被熔断为 wait:human_review(global_loop_breaker)', () => {
    const r = derive(observed(repeatedSpawns(5)));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('global_loop_breaker');
  });

  it('负向：4 次同派发 → 不熔断，照常派第 5 次', () => {
    const r = derive(observed(repeatedSpawns(4)));
    expect(r.action).toBe('spawn:judge');
    expect(r.reason).toBe('evaluate_completed_awaiting_judge');
  });

  it('负向：期间出现 generator-fix（新候选）→ 计数重置，不熔断', () => {
    const rows = repeatedSpawns(5);
    rows.splice(4, 0, {
      hop: 13.5,
      action: 'spawn:generator-fix',
      observed: { trigger_sha: HEAD },
      detail: { reason: 'ci_fail' },
    });
    const r = derive(observed(rows));
    expect(r.action).toBe('spawn:judge');
  });

  it('负向：同 action 不同 reason 交替 → 不算同一循环，不熔断', () => {
    const rows = [];
    let hop = 10;
    for (let i = 0; i < 6; i++) {
      rows.push({
        hop,
        action: 'spawn:judge',
        observed: { pr: null },
        detail: { reason: i % 2 === 0 ? 'evaluate_completed_awaiting_judge' : 'evaluate_passed_awaiting_judge' },
      });
      hop += 1;
    }
    const r = derive(observed(rows));
    expect(r.action).toBe('spawn:judge');
  });
});
