/**
 * GP-Anchor: factory/F1 造完真验 #step3
 * 历史循环纯逻辑合同：外部派发边完全注入，不启动已退役Kernel运行。
 *
 * 第 31 批（r62 run fa772ff4 案卷）：approved_but_contract_artifacts_missing
 * 直接 failRun 终局，而同类合同缺陷 seal_rejected 有 2 次 proposer 重写机会——
 * 不对称。proposer 输出波动（r61 建了冻结测试/r62 没建）应走同一条自愈路：
 * missing 时落 verdict:contract_seal_rejected（code=FROZEN_CONTRACT_ARTIFACTS_MISSING）
 * 并 continue，derive 既有 seal_rejected 分路自动带反馈重开 proposer（≥2 次才判死）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn(() => { throw new Error('历史循环测试禁止访问默认数据库'); }) },
}));
import defaultPool from '../../../packages/brain/src/db.js';
afterEach(() => expect(defaultPool.query).not.toHaveBeenCalled());
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';
import { sealRejectionInstruction } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const CONTRACT_SHA = 'f'.repeat(40);

describe('dispatcher：ARTIFACTS_MISSING 分文案', () => {
  it('指示合同四件套含 tests/ 冻结测试必须全部 commit', () => {
    const text = sealRejectionInstruction('FROZEN_CONTRACT_ARTIFACTS_MISSING');
    expect(text).toMatch(/tests|冻结测试/);
    expect(text).toMatch(/commit|提交/);
  });
});

describe('历史loop：缺产物记录拒绝后，下轮真实推导proposer重写', () => {
  function makeEnv() {
    const appended = [];
    const observedPersist = {
      run: { id: RUN_ID, phase: 'gan', cost_usd: 0 },
      task: {
        status: 'in_progress',
        payload: { sprint_dir: 'sprints/x', base_repo: 'https://github.com/perfectuser21/cecelia.git' },
      },
      prdExists: true,
      pr: null,
      candidate: null,
      contract: { approved: false, id: null, identity: null },
      inflight: { containers: [], host_pids: [], attempts: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 1,
      proposeBranch: 'cp-harness-propose-r1-x',
      proposeBranchSha: CONTRACT_SHA,
      ganLatestRoundVerdict: 'APPROVED',
      ganLatestRoundContractSha: CONTRACT_SHA,
      generatorSpawned: false,
      evaluateVerdict: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: [],
    };
    const observedDone = {
      ...observedPersist,
      run: { id: RUN_ID, phase: 'done', cost_usd: 0 },
    };
    const seq = [observedPersist, observedPersist, observedDone];
    let i = 0;
    let hopCounter = 0;
    const persistedRows = [];
    const deps = {
      pool: {
        query: vi.fn().mockImplementation(async (sql) => {
          if (String(sql).includes('FROM tasks')) {
            return { rows: [{ payload: observedPersist.task.payload }] };
          }
          return { rows: [] };
        }),
      },
      collectGroundTruth: vi.fn().mockImplementation(async () => {
        const value = seq[Math.min(i, seq.length - 1)];
        i++;
        return { ...value, decisionLog: [...value.decisionLog, ...persistedRows] };
      }),
      nextHop: vi.fn(async () => { hopCounter++; return hopCounter; }),
      appendHop: vi.fn(async (entry) => {
        appended.push(entry);
        persistedRows.push({
          hop: entry.hop, action: entry.action, observed: entry.observed,
          gate_verdict: entry.gateVerdict, detail: entry.detail,
        });
      }),
      writeHeartbeat: vi.fn(async () => {}),
      dispatch: vi.fn(async () => ({ status: 'DONE', detail: 'ok' })),
      impactGate: {
        beforeGenerate: vi.fn(async () => ({ gate: 'pass', stage: 'structure' })),
        beforeEvaluate: vi.fn(async () => ({ gate: 'pass', stage: 'diff' })),
        beforeMerge: vi.fn(async () => ({ gate: 'pass', stage: 'merge' })),
      },
      finalizeRun: vi.fn(async () => ({ changed: true, outcome: 'failed', runId: RUN_ID, taskId: TASK_ID })),
      sleep: vi.fn(async () => {}),
      now: () => new Date('2026-08-24T04:00:00Z'),
      host: 'test-host',
      pid: 4242,
      log: vi.fn(),
      // 不提供 readGitFile/listGitFiles → frozenContractArtifacts 必 missing
    };
    return { deps, appended };
  }

  it('记录拒绝后再收集同一合同，派发proposer重写并明确退出', async () => {
    const { deps, appended } = makeEnv();
    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(result).toEqual({ exitReason: 'run_done', hops: 1 });
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch.mock.calls[0][0]).toBe('spawn:proposer');
    expect(deps.dispatch.mock.calls[0][1].decision).toEqual({
      phase: 'gan', action: 'spawn:proposer', reason: 'contract_seal_rejected_rewrite',
    });
    expect(deps.collectGroundTruth).toHaveBeenCalledTimes(3);
    expect(deps.finalizeRun).not.toHaveBeenCalled();
    const sealRow = appended.find((r) => r.action === 'verdict:contract_seal_rejected');
    expect(appended.filter(r => r.action === 'verdict:contract_seal_rejected')).toHaveLength(1);
    expect(sealRow).toBeTruthy();
    expect(sealRow.detail.code).toBe('FROZEN_CONTRACT_ARTIFACTS_MISSING');
    expect(sealRow.detail.propose_branch_sha).toBe(CONTRACT_SHA);
    expect(String(sealRow.detail.detail)).toMatch(/sprint-prd|contract-draft|tests/);
  });
});
