/**
 * loop/derive 确定性 impact 出口路由测试 —— sprint 08171726-kernel-3b150c01
 *
 * 根因：diff-gate 把确定性结论标成 mapper_stale/retryable:true → kernel 每 90s 无限重试到 deadline。
 * 修法：确定性结论 retryable:false → loop 不再 infrastructure_blocked 退避、也不再 blanket failRun，
 * 而是记 BLOCKED 结果后由 derive 按 reason 路由：
 *   impact_anchor_missing              → spawn:generator-fix（携带 unclaimed_files），仍失败→human_review
 *   capability_assertion_coverage_missing → wait:human_review
 *
 * 本测试用真 runLoop + 真 derive（fake collectGroundTruth 喂 observed、fake dispatch 记录动作），
 * 不 mock 被改的 loop/derive 决策本体；beforeEvaluate 注入确定性 blocked receipt（retryable:false）。
 * 冻结产物：Proposer 落 sprints/<sprint_dir>/tests/；Generator 复制到 packages/brain/src/orchestrator/__tests__/。
 */
import { describe, it, expect, vi } from 'vitest';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const CONTRACT_ID = '99999999-8888-7777-6666-555555555555';
const CONTRACT_IDENTITY = Object.freeze({
  contract_id: CONTRACT_ID,
  manifest_sha256: 'a'.repeat(64),
  source_revision: 'b'.repeat(40),
});
const HEAD_SHA = 'b'.repeat(40);

function obs(overrides = {}) {
  const observed = {
    run: { id: RUN_ID, phase: 'generate', cost_usd: 0 },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, id: CONTRACT_ID },
    pr: null,
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    authCircuit: [],
    callbackResult: null,
    ...overrides,
  };
  if (observed.contract?.approved === true && observed.contract.identity == null) {
    observed.contract = { ...observed.contract, identity: CONTRACT_IDENTITY };
  }
  return observed;
}

function makeEnv({ observedSeq, dispatch } = {}) {
  let i = 0;
  let hopCounter = 0;
  const appended = [];
  const persistedRows = [];
  const heartbeats = [];
  const sleeps = [];
  const deps = {
    pool: {
      query: vi.fn(async (sql, params) => {
        if (sql.includes('SELECT run.initiative_id, run.current_task_id')) {
          return { rows: [{ initiative_id: TASK_ID, current_task_id: TASK_ID }] };
        }
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [{}] };
        if (sql.includes('SELECT id FROM tasks') && sql.includes('FOR UPDATE')) {
          return { rows: [{ id: TASK_ID }] };
        }
        if (sql.includes('SELECT run.initiative_id, run.contract_id')) {
          return { rows: [{ initiative_id: TASK_ID, contract_id: null }] };
        }
        if (sql.includes('FOR UPDATE OF run, task')) {
          return { rows: [{ initiative_id: TASK_ID, contract_id: null }] };
        }
        return { rows: [] };
      }),
    },
    collectGroundTruth: vi.fn(async () => {
      const o = observedSeq[Math.min(i, observedSeq.length - 1)];
      i++;
      const value = typeof o === 'function' ? o() : o;
      return { ...value, decisionLog: [...(value.decisionLog ?? []), ...persistedRows] };
    }),
    nextHop: vi.fn(async () => { hopCounter++; return hopCounter; }),
    appendHop: vi.fn(async (entry) => {
      appended.push(entry);
      persistedRows.push({
        hop: entry.hop,
        action: entry.action,
        observed: entry.observed,
        gate_verdict: entry.gateVerdict,
        detail: entry.detail,
      });
    }),
    writeHeartbeat: vi.fn(async (pool, entry) => { heartbeats.push(entry); }),
    dispatch: vi.fn(dispatch ?? (async () => ({ status: 'DONE', detail: 'ok' }))),
    impactGate: {
      beforeGenerate: vi.fn(async () => ({ gate: 'pass', stage: 'structure' })),
      beforeEvaluate: vi.fn(async () => ({ gate: 'pass', stage: 'diff' })),
      beforeMerge: vi.fn(async () => ({ gate: 'pass', stage: 'merge' })),
    },
    finalizeRun: vi.fn(async () => ({ changed: true, outcome: 'failed', runId: RUN_ID, taskId: TASK_ID })),
    sleep: vi.fn(async (ms) => { sleeps.push(ms); }),
    now: () => new Date('2026-08-16T12:00:00Z'),
    host: 'test-host',
    pid: 4242,
    log: vi.fn(),
  };
  return { deps, appended, heartbeats, sleeps, setHopBase: (n) => { hopCounter = n; } };
}

function evaluatorTriggerObs() {
  return obs({
    generatorSpawned: true,
    pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: HEAD_SHA },
    decisionLog: [{ hop: 1, action: 'spawn:generator', created_at: '2026-08-16T11:00:00Z' }],
  });
}

describe('确定性 impact 结论按 reason 走确定性出口（08171726-kernel-3b150c01）', () => {
  it('impact_anchor_missing（retryable:false）→ 路由 spawn:generator-fix，不 blanket failRun', async () => {
    const observedSeq = [
      evaluatorTriggerObs(),
      evaluatorTriggerObs(),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, appended, setHopBase } = makeEnv({ observedSeq });
    setHopBase(1);
    deps.impactGate.beforeEvaluate.mockResolvedValue({
      gate: 'blocked',
      stage: 'diff',
      reason: 'impact_anchor_missing',
      reason_code: 'impact_anchor_missing',
      retryable: false,
      unclaimed_files: ['DoD.md'],
      detail: { unclaimed_files: ['DoD.md'], capability_ids: [] },
      head_revision: HEAD_SHA,
    });

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    // 决策日志 intent 行透传 reason_code + retryable + unclaimed_files
    const intent = appended.find((e) => e.action === 'spawn:evaluator');
    expect(intent.gateVerdict).toBe('deny:impact:impact_anchor_missing');
    expect(intent.detail.impact_gate.retryable).toBe(false);
    expect(intent.detail.impact_gate.unclaimed_files).toEqual(['DoD.md']);

    // 路由到 generator-fix，而不是无限重试或 blanket failRun
    const dispatched = deps.dispatch.mock.calls.map(([action]) => action);
    expect(dispatched).toContain('spawn:generator-fix');
  });

  it('capability_assertion_coverage_missing（retryable:false）→ 路由 wait:human_review', async () => {
    const observedSeq = [
      evaluatorTriggerObs(),
      evaluatorTriggerObs(),
      obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } }),
    ];
    const { deps, setHopBase } = makeEnv({ observedSeq });
    setHopBase(1);
    deps.impactGate.beforeEvaluate.mockResolvedValue({
      gate: 'blocked',
      stage: 'diff',
      reason: 'capability_assertion_coverage_missing',
      reason_code: 'capability_assertion_coverage_missing',
      retryable: false,
      unclaimed_files: [],
      detail: { unclaimed_files: [], capability_ids: ['G1'] },
      head_revision: HEAD_SHA,
    });

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    const dispatched = deps.dispatch.mock.calls.map(([action]) => action);
    expect(dispatched).toContain('wait:human_review');
  });
});
