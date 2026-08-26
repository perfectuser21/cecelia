// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：commander runner_failure 有界重派 ↔ 早期无锚人审落地
//
// r77 (run 06aea1e3) 双实证：
// ① 37 批（#5069）的 commander 有界重派只覆盖 failure_class=infrastructure_blocked
//    分支——runner_failure 分支漏（infrastructureRetryForCallback('commander') 仍
//    null → wait:human_review(callback_runner_failure_route_unknown)），每次 commander
//    的 attempt 以 runner_failure 收场仍旧挂人审。
// ② GAN 早期（proposer/reviewer 阶段）候选未冻结、无 PR，wait:human_review 的
//    dispatch handler 返回 BLOCKED('human review requires a PR URL or a frozen
//    candidate') → blocked_same_state 两连秒死。人审请求本身成了死路（第 4 个
//    无出口场景；2026-08-18 run c4339041 修过"只有候选"的版本，"连候选都没有"漏）。
//
// 修法（本批）：
// a) derive：runner_failure 分支给 commander 同款有界重派（同 run 内 commander
//    runner_failure 类 failed callback 序号 < CAP 时不挂人审返回 null 回主链；
//    ≥ CAP 时 fail-closed 挂人审带 callbackHop 锚）。
// b) kernel-handlers：无 PR 无候选时人审请求降级为无锚落地（DONE + 通知带
//    run_id、pr_head_sha=null），不再 BLOCKED——保住人来判断的机会而非机器秒死。
//
// 真 import derive 与 createKernelHandlers（被改的边），deps 注入 stub。
import { describe, it, expect, vi } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { createKernelHandlers } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';

const IDENTITY = { contract_id: 'c77', manifest_sha256: 'm77', source_revision: 'r77' };

function ganObserved(overrides = {}) {
  return {
    run: { phase: 'gan' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: false },
    pr: null,
    candidate: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 66, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

const commanderRunnerFailure = (hop) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: {
    role: 'commander',
    status: 'failed',
    failure_class: 'runner_failure',
    attempt_id: `44444444-4444-4444-8444-${String(hop).padStart(12, '0')}`,
  },
});

describe('F1 step3 — commander runner_failure 有界重派（r77 案卷①）', () => {
  it('单条 commander runner_failure（<CAP）→ 不挂人审，回主链', () => {
    const r = derive(ganObserved({
      decisionLog: [
        { hop: 60, action: 'spawn:commander', detail: { reason: 'phase_changed' } },
        commanderRunnerFailure(64),
      ],
    }));
    expect(r.action).not.toBe('wait:human_review');
  });

  it('达 CAP（5 条）→ fail-closed 挂人审带 callbackHop', () => {
    const rows = [{ hop: 40, action: 'spawn:commander', detail: { reason: 'phase_changed' } }];
    [42, 44, 46, 48, 50].forEach((h) => rows.push(commanderRunnerFailure(h)));
    const r = derive(ganObserved({ decisionLog: rows }));
    expect(r.action).toBe('wait:human_review');
    expect(r.reason).toBe('callback_runner_failure_route_unknown');
    expect(r.callbackHop).toBe(50);
  });

  it('负向：非 commander 角色 runner_failure 语义不变（穷尽后仍人审路由）', () => {
    const r = derive(ganObserved({
      decisionLog: [
        { hop: 60, action: 'spawn:proposer', detail: { reason: 'no_contract_yet' } },
        { hop: 62, action: 'verdict:attempt_callback', detail: { role: 'proposer', status: 'failed', failure_class: 'runner_failure', attempt_id: '44444444-4444-4444-8444-000000000062' } },
      ],
    }));
    // proposer 有 INFRA_RETRY_ACTION_BY_ROLE 重试路由 → 重派 proposer（非人审）
    expect(['spawn:proposer', 'wait:human_review']).toContain(r.action);
    expect(r.action).not.toBe('wait:human_review');
  });
});

describe('F1 step3 — GAN 早期无锚人审落地（r77 案卷②）', () => {
  function makeHandlers() {
    const notifyReview = vi.fn(async () => {});
    const handlers = createKernelHandlers({
      pool: { query: vi.fn(async () => ({ rows: [] })) },
      notifyReview,
      log: () => {},
    });
    return { handlers, notifyReview };
  }

  it('无 PR 无候选 → DONE 无锚落地（不再 BLOCKED 秒死），通知带 run_id', async () => {
    const { handlers, notifyReview } = makeHandlers();
    const result = await handlers['wait:human_review']({
      runId: '06aea1e3-31a6-4989-a24c-758b4c59f74e',
      taskId: '6a2d5b6e-7486-4fad-ba8f-ed3a0295d468',
      observed: { pr: null, candidate: null, task: { title: 'r77', payload: {} } },
      bundle: { inputs: {} },
    });
    expect(result.status).toBe('DONE');
    expect(String(result.detail)).toContain('unanchored');
    expect(notifyReview).toHaveBeenCalledTimes(1);
    expect(notifyReview.mock.calls[0][0].pr_head_sha).toBeNull();
  });

  it('有冻结候选 → 行为不变（候选锚落地）', async () => {
    const { handlers, notifyReview } = makeHandlers();
    const result = await handlers['wait:human_review']({
      runId: '06aea1e3-31a6-4989-a24c-758b4c59f74e',
      taskId: '6a2d5b6e-7486-4fad-ba8f-ed3a0295d468',
      observed: {
        pr: null,
        candidate: { branch: 'cp-route-api-x', head_sha: 'f'.repeat(40) },
        task: { title: 'r77', payload: {} },
      },
      bundle: { inputs: {} },
    });
    expect(result.status).toBe('DONE');
    expect(String(result.detail)).toContain('local candidate');
    expect(notifyReview.mock.calls[0][0].pr_head_sha).toBe('f'.repeat(40));
  });
});
