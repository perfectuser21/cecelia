// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：commander lease 过期终态回调 ↔ derive 有界重派
//
// r70/r71/r72 三轮生产实证：kernel commander attempt 的 lease 过期被收割器 reconcile
//   （effect:expired_attempt_reconciled, role=commander, status=failed,
//    failure_class=infrastructure_blocked,
//    signature=worker_attempt_replacement_required_after_lease）后，
//   infrastructureRetryForCallback('commander', …) 因 INFRA_RETRY_ACTION_BY_ROLE 无
//   commander 键返回 undefined → derive 落 wait:human_review
//   （reason=callback_infrastructure_route_unknown）→ 每轮都要人批一次 diagnostic。
//   八角色（planner/proposer/reviewer/generator/evaluator/judge/publisher/reporter）
//   都已有 infrastructure_blocked 重试路由，commander 是唯一缺席者（无人值守最后一块石头）。
//
// 修法（本 sprint，唯一实现文件 packages/brain/src/orchestrator/derive.js）：
//   commander 的 infrastructure_blocked 终态回调纳入有界重派——同 run 内累计失败
//   < 5 次时按当前 phase 重派 commander（action='spawn:commander'，reason 归属
//   infrastructure 重试族 callback_infrastructure_blocked；commander 是监理角色，
//   重派无副作用）；累计达上限（第 6 次失败）后仍回落 wait:human_review
//   （reason=callback_infrastructure_route_unknown，带 callbackHop 锚），fail-closed 兜底。
//   dispatcher.js 已注册 'spawn:commander' 动作（line 122），derive 发出即可被派发。
//
// 铁律护栏（本测试同时锁死，防实现越界）：
//   - 纯函数可重放：只依赖 orchestrator_decision_log 行时序统计历史失败次数，
//     不引入新状态存储（真 import derive.js，传真实 decisionLog 数组，禁 mock 被改的边）。
//   - fail-closed：有界上限触顶后必须回落人审，禁止无限重派。
//   - 不动 account_exhausted / runner_failure / semantic_refusal 既有分支：commander 的
//     非 infrastructure 类失败语义完全不变（负向 Test 5/6/7 锁死——防实现把 commander
//     塞进 infrastructureRetryForCallback 共享 map 而污染这三条分支）。
//
// 按 GP 产物闸规矩写在边上：真 derive，不 stub attemptCallbackRoute /
// infrastructureRetryForCallback / INFRA_RETRY_ACTION_BY_ROLE。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

const IDENTITY = { contract_id: 'c73', manifest_sha256: 'm73', source_revision: 'r73' };

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'evaluate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, identity: IDENTITY },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 120, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// commander attempt lease 过期被收割器 reconcile（r70 hop112 实录形状）
const spawnCommander = (hop) => ({ hop, action: 'spawn:commander', detail: {} });
const expiredCommanderInfra = (hop) => ({
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

// 普通 attempt_callback（非 expired 终态，承载 account_exhausted / runner_failure / semantic_refusal）
const commanderCallback = (hop, failureClass, status = 'failed') => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: { hop: hop - 1, role: 'commander', status, failure_class: failureClass },
});

// 构造 N 次「spawn:commander → 过期 infra 收割」的重放链，末尾一次为当前待路由回调
function commanderInfraChain(count) {
  const rows = [];
  let hop = 100;
  for (let i = 0; i < count; i += 1) {
    rows.push(spawnCommander(hop));
    rows.push(expiredCommanderInfra(hop + 1));
    hop += 2;
  }
  return rows;
}

describe('F1 step3 — commander lease 过期 infrastructure 有界自动重派（r73 案卷）', () => {
  // ── 正向（现状 RED：commander 缺重试路由落人审；修后 GREEN：有界重派 commander）──

  it('复刻 r70：单次 commander 过期 infra 回调 → 重派 commander 续主链，不再落 route_unknown 人审', () => {
    const r = derive(baseObserved({
      decisionLog: [spawnCommander(101), expiredCommanderInfra(112)],
    }));
    expect(r.action).toBe('spawn:commander');
    expect(r.reason).toBe('callback_infrastructure_blocked');
    expect(r.action).not.toBe('wait:human_review');
    expect(['review', 'failed', 'paused']).not.toContain(r.phase);
  });

  it('未达上限（累计第 5 次失败）→ 仍有界重派 commander', () => {
    // 4 次历史过期 infra + 当前第 5 次（末尾）；prior(hop<current)=4 < 5 → 重派
    const r = derive(baseObserved({
      decisionLog: commanderInfraChain(5),
    }));
    expect(r.action).toBe('spawn:commander');
    expect(r.reason).toBe('callback_infrastructure_blocked');
  });

  // ── 负向 fail-closed：达上限后仍回落人审（禁止无限重派）──

  it('达上限（累计第 6 次失败）→ 仍 wait:human_review（route_unknown + callbackHop 锚），fail-closed', () => {
    // 5 次历史过期 infra + 当前第 6 次（末尾 hop=111）；prior(hop<111)=5 ≥ 5 → 人审
    const r = derive(baseObserved({
      decisionLog: commanderInfraChain(6),
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_infrastructure_route_unknown');
    expect(r.callbackHop).toBe(111);
  });

  // ── 负向：非 commander 角色 infrastructure 重试路由语义完全不变 ──

  it('负向：planner 过期 infra 回调重试路由不变（spawn:planner + callback_infrastructure_blocked）', () => {
    const r = derive(baseObserved({
      decisionLog: [
        { hop: 100, action: 'spawn:planner', detail: {} },
        {
          hop: 101,
          action: 'effect:expired_attempt_reconciled',
          detail: { role: 'planner', status: 'failed', failure_class: 'infrastructure_blocked' },
        },
      ],
    }));
    expect(r).toMatchObject({
      phase: 'planning',
      action: 'spawn:planner',
      reason: 'callback_infrastructure_blocked',
    });
  });

  // ── 负向：commander 非 infrastructure 类失败语义完全不变（防污染共享分支）──

  it('负向：commander semantic_refusal 仍走 callback_semantic_refusal 人审（不被本次放宽）', () => {
    const r = derive(baseObserved({
      decisionLog: [spawnCommander(100), commanderCallback(101, 'semantic_refusal')],
    }));
    expect(r).toMatchObject({
      action: 'wait:human_review',
      reason: 'callback_semantic_refusal',
    });
  });

  it('负向：commander account_exhausted 仍走 callback_account_exhausted_route_unknown（不动既有分支）', () => {
    // 若实现把 commander 塞进 INFRA_RETRY_ACTION_BY_ROLE 共享 map，此分支会误翻转为重派 → 本测试必挂
    const r = derive(baseObserved({
      decisionLog: [spawnCommander(100), commanderCallback(101, 'account_exhausted')],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_account_exhausted_route_unknown');
    expect(r.callbackHop).toBe(101);
  });

  it('负向：commander runner_failure（首次）仍走 callback_runner_failure_route_unknown（不动既有分支）', () => {
    // 同上：共享 map 污染会让首次 runner_failure 误翻转为重派 → 本测试必挂
    const r = derive(baseObserved({
      decisionLog: [spawnCommander(100), commanderCallback(101, 'runner_failure')],
    }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_runner_failure_route_unknown');
    expect(r.callbackHop).toBe(101);
  });
});
