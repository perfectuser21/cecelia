import { describe, expect, it } from 'vitest';
import { derive } from '../derive.js';

// 2026-08-17 生产实证（run ba3cdfac，task f01f2e2e）：首个 Generator 落在过期的 account1 上
// provider_unavailable（infrastructure_blocked）→ 原地重试 spawn:generator（hop 27）被 fleet
// 准入 503 挡回（result:dispatch deny:BLOCKED，不是 attempt 失败）→ 重试额度被这一次挡回吃掉
// → 下一跳 deriveTask 看到 generatorSpawned=true 且无候选 → fixRoute('no_pr') → generator-fix
// 要求上一轮 Generator 的工作区证据 → generator_fix_workspace_evidence_missing → run 判死
// assembly_fault:WORKSPACE_RESOLUTION_FAILED。Generator 从未真正跑过（没有任何 completed 回调），
// 就不该进 fix 轮；应继续重派 Generator（dispatcher 会用 listFailedExecutionTargets 排除
// 已失败的账号目标）。上限：连续基础设施失败 ≥4 次才判死，防无限重派。
function observed(decisionLog, overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
    candidate: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 1, auth_failed: false, action: 'spawn:generator' },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 10, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    decisionLog,
    ...overrides,
  };
}
const infraFail = (hop, dispatchedHop) => ({
  hop, action: 'verdict:attempt_callback',
  detail: { role: 'generator', hop: dispatchedHop, status: 'failed', failure_class: 'infrastructure_blocked', error_code: 'provider_unavailable' },
});
const blockedDispatch = (hop, dispatchHop) => ({
  hop, action: 'result:dispatch', gate_verdict: 'deny:BLOCKED',
  detail: { status: 'BLOCKED', result: 'dispatch preflight blocked: node_not_base_admitted', dispatch_hop: dispatchHop, dispatch_action: 'spawn:generator', failure_class: 'infrastructure_blocked' },
});

describe('Generator 从未真正跑过（只有基础设施失败）时不得进 generator-fix', () => {
  it('原地重试被 dispatch 准入挡回后，仍重派 spawn:generator 而不是 generator-fix', () => {
    const r = derive(observed([
      { hop: 24, action: 'spawn:generator', observed: {} },
      infraFail(26, 24),
      { hop: 27, action: 'spawn:generator', observed: {} },
      blockedDispatch(28, 27),
    ]));
    expect(r.phase).toBe('generate');
    expect(r.action).toBe('spawn:generator');
    expect(r.reason).toBe('generator_infrastructure_respawn');
  });

  it('曾有 Generator 完成回调（有过候选）时，仍按原语义走 fix 轮', () => {
    const r = derive(observed([
      { hop: 24, action: 'spawn:generator', observed: {} },
      { hop: 25, action: 'verdict:attempt_callback', detail: { role: 'generator', hop: 24, status: 'completed', artifacts: [] } },
      { hop: 26, action: 'spawn:generator-fix', observed: {} },
      infraFail(28, 26),
      { hop: 29, action: 'spawn:generator-fix', observed: {} },
      blockedDispatch(30, 29),
    ]));
    expect(r.action).toBe('spawn:generator-fix');
  });

  it('连续 4 次基础设施失败仍无候选 → 判死 generator_infrastructure_exhausted', () => {
    const log = [];
    let hop = 10;
    for (let i = 0; i < 4; i += 1) {
      log.push({ hop, action: 'spawn:generator', observed: {} });
      log.push(infraFail(hop + 1, hop));
      hop += 2;
    }
    log.push({ hop, action: 'spawn:generator', observed: {} });
    log.push(blockedDispatch(hop + 1, hop));
    const r = derive(observed(log));
    expect(r.phase).toBe('failed');
    expect(r.reason).toBe('generator_infrastructure_exhausted');
  });
});
