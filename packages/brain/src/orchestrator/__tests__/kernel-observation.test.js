import { describe, expect, it, vi } from 'vitest';
import { runLoop } from '../loop.js';
import { buildRealDeps, runKernelMain } from '../run.js';

const taskId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-13T12:00:00Z');

function observation(phase = 'generate') {
  return {
    run: { id: runId, phase, cost_usd: 0, deadline_at: '2026-11-13T11:00:00Z' },
    task: { id: taskId, status: 'in_progress', payload: {} },
    contract: { approved: true, id: 'contract', identity: { contract_id: 'contract' } },
    prdExists: true, pr: null,
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0, ganLatestRoundVerdict: null,
    generatorSpawned: false, evaluateVerdict: null, judgeVerdict: null,
    reviewRequired: false, reviewApproved: false,
    decisionLog: [], authCircuit: [], callbackResult: null,
  };
}

function fixture({ expired = false, phase } = {}) {
  const mutations = [];
  const effect = name => vi.fn(async () => { mutations.push(name); return { changed: true }; });
  const pool = {
    query: vi.fn(async sql => {
      if (!/^\s*SELECT\b/i.test(sql)) mutations.push(sql);
      return { rows: expired ? [{ deadline_at: '2026-11-13T11:00:00Z' }] : [] };
    }),
    end: vi.fn(),
  };
  const deps = {
    pool, now: () => now, log: vi.fn(),
    collectGroundTruth: vi.fn(async () => observation(phase)),
    activateContextResume: effect('resume'), finalizeRun: effect('terminal'),
    dispatch: effect('dispatch'), writeHeartbeat: effect('heartbeat'),
    appendHop: effect('append'), nextHop: effect('next-hop'),
  };
  return { pool, deps, mutations };
}

describe('历史 Kernel 观察入口', () => {
  it('过期运行只返回观察，不写终态或任何数据库状态', async () => {
    const { deps, mutations } = fixture({ expired: true });
    const result = await runLoop(deps, { taskId, runId, dryRun: true });
    expect(result.exitReason).toBe('dry_run');
    expect(result.hops).toBe(0);
    expect(result.decision).toMatchObject({ phase: 'generate', action: 'spawn:generator' });
    expect(deps.collectGroundTruth).toHaveBeenCalledOnce();
    expect(mutations).toEqual([]);
  });

  it.each(['generate', 'done', 'failed'])('%s 运行携带恢复 token 也不消费 token 或派发', async phase => {
    const { deps, mutations } = fixture({ phase });
    const result = await runLoop(deps, { taskId, runId, resumeToken: 'historical-token', dryRun: true });
    expect(result.exitReason).toBe('dry_run');
    expect(mutations).toEqual([]);
    expect(deps.activateContextResume).not.toHaveBeenCalled();
    expect(deps.finalizeRun).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.writeHeartbeat).not.toHaveBeenCalled();
  });

  it('观察依赖不启动 execution directory、派发器或后台执行能力', async () => {
    const { pool, mutations } = fixture();
    const startExecutionDirectory = vi.fn(async () => { mutations.push('execution-directory'); });
    const createProductionCapabilityProbesFn = vi.fn(() => { mutations.push('capability-probes'); });
    const deps = await buildRealDeps({
      readOnly: true, pool, startExecutionDirectory, createProductionCapabilityProbesFn,
      dispatch: vi.fn(), env: { CECELIA_MACHINE_ID: 'us-mac-m4' },
    });
    expect(mutations).toEqual([]);
    expect(startExecutionDirectory).not.toHaveBeenCalled();
    expect(createProductionCapabilityProbesFn).not.toHaveBeenCalled();
    expect(deps.dispatch).toBeUndefined();
    expect(deps.commanderCoordinator).toBeUndefined();
  });

  it('CLI dry-run 实际选择只读依赖，过期记录不触发启动或收账', async () => {
    const { pool, deps, mutations } = fixture({ expired: true });
    const startExecutionDirectory = vi.fn(async () => { mutations.push('execution-directory'); });
    const result = await runKernelMain({ taskId, runId, dryRun: true }, {
      buildDeps: async options => ({
        ...await buildRealDeps({ ...options, pool, startExecutionDirectory,
          dispatch: deps.dispatch, env: { CECELIA_MACHINE_ID: 'us-mac-m4' } }),
        collectGroundTruth: deps.collectGroundTruth, finalizeRun: deps.finalizeRun,
        now: deps.now, log: deps.log,
      }),
    });
    expect(result.exitReason).toBe('dry_run');
    expect(mutations).toEqual([]);
    expect(startExecutionDirectory).not.toHaveBeenCalled();
  });

  it('直接调用旧循环也不能重新启用 Kernel 执行', async () => {
    const { deps, mutations } = fixture();
    await expect(runLoop(deps, { taskId, runId, dryRun: false }))
      .rejects.toMatchObject({ code: 'kernel_runtime_retired' });
    expect(deps.collectGroundTruth).not.toHaveBeenCalled();
    expect(mutations).toEqual([]);
  });
});
