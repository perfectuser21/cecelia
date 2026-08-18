/**
 * TDD-Red 回归测试 —— 修复 gan_no_push_streak 误判（run 7a8e5319 / task ff2b0fa9）。
 *
 * 根因：ground-truth 观测提案分支时 `parseBaseRepo(taskPayload.base_repo)` 只读 base_repo；
 * 缺 base_repo（但有 repo）时 taskRepo=null → proposalRemote 静默退 `origin` → origin 结构上
 * 看不到 GitHub 已推分支 → ls-remote 空 → proposeBranchRn 恒 0 → noPushStreak 累积 → 误判
 * gan_no_push_streak 把真提案 mark_failed。
 *
 * 本文件 = 合同阶段 GAN Red 证据（root vitest include sprints/**）。永久回归须同源落进
 * packages/brain/src/orchestrator/__tests__/ground-truth.test.js（brain-CI），由 generator 端口。
 *
 * 全 mock 边说明（禁 mock 被改的边，v9.12）：被改的边 = collectGroundTruth 提案 remote 解析 →
 * observed.proposeBranchRn → deriveCounters → derive，本文件用真 collectGroundTruth / 真 deriveCounters /
 * 真 derive，一条不 mock；只注入 git 子进程（execCmd）与 DB pool 两个最外层边界（postgres 不参与，
 * 观测逻辑是纯字符串/命令推导，非 DB 写路径）。
 */
import { describe, it, expect, vi } from 'vitest';
import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';

const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const SHORT_TASK = '11111111';
const SHORT_RUN = 'aaaaaaaa';

/** 宽松 fakePool：命中的表返回填充行，其余一律空集（不抛 unexpected sql，稳健对抗上游查询增删）。 */
function fakePool({ run, task, log = [] }) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('FROM initiative_runs')) return { rows: run ? [run] : [] };
      if (sql.includes('FROM tasks')) return { rows: task ? [task] : [] };
      if (sql.includes('FROM orchestrator_decision_log')) return { rows: log };
      return { rows: [] };
    }),
  };
}

/** 记录所有命令的 fakeExecCmd；ls-remote 返回注入输出，其余外部命令返回空。 */
function fakeExecCmd(lsRemote = '') {
  const calls = [];
  const fn = vi.fn((cmd) => {
    calls.push(cmd);
    if (cmd.includes('ls-remote')) return lsRemote;
    return '';
  });
  fn.calls = calls;
  return fn;
}

function makeDeps({ payload, lsRemote = '', log = [] }) {
  const pool = fakePool({
    run: { id: RUN_ID, contract_id: null, phase: 'gan', pr_url: null, cost_usd: '0', current_task_id: TASK_ID, gear: 'default' },
    task: { id: TASK_ID, status: 'in_progress', payload },
    log,
  });
  const execCmd = fakeExecCmd(lsRemote);
  return {
    pool,
    execCmd,
    fileExists: vi.fn(() => false),
    readFile: vi.fn(() => { throw new Error('ENOENT'); }),
  };
}

describe('gan_no_push_streak 误判修复：提案 remote 解析兜底链 + fail-closed', () => {
  it('B-01: 缺 base_repo 但含 repo，ls-remote 打真实 GitHub remote 不退 origin', async () => {
    const deps = makeDeps({
      payload: { repo: 'cecelia' }, // 缺 base_repo（复现根因场景）
      lsRemote: `${'a'.repeat(40)}\trefs/heads/cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a38`,
    });
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });

    const cmd = deps.execCmd.calls.find((c) => c.includes('ls-remote'));
    expect(cmd).toContain('https://github.com/perfectuser21/cecelia.git');
    expect(cmd).not.toMatch(/ls-remote --heads origin\b/);
  });

  it('B-02: 缺 base_repo 但含 repo 且已推分支，proposeBranchRn>=1', async () => {
    const deps = makeDeps({
      payload: { repo: 'cecelia' },
      lsRemote: `${'a'.repeat(40)}\trefs/heads/cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a38`,
    });
    const observed = await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    expect(observed.proposeBranchRn).toBeGreaterThanOrEqual(1);
    expect(observed.proposeBranch).toBe(`cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a38`);
  });

  it('B-03: base_repo 与 repo 均不可解析，fail-closed 不发出 ls-remote --heads origin', async () => {
    const deps = makeDeps({ payload: {} }); // 均缺失
    await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    const hitOrigin = deps.execCmd.calls.some((c) => /ls-remote --heads origin\b/.test(c));
    expect(hitOrigin).toBe(false);
  });

  it('B-04: 回归 base_repo 正常可解析，仍打 GitHub remote 不退 origin', async () => {
    const deps = makeDeps({
      payload: { base_repo: 'https://github.com/perfectuser21/cecelia.git', repo: 'cecelia' },
      lsRemote: `${'a'.repeat(40)}\trefs/heads/cp-harness-propose-r1-${SHORT_TASK}-r${SHORT_RUN}-a38`,
    });
    await collectGroundTruth(deps, { taskId: TASK_ID, runId: RUN_ID });
    const cmd = deps.execCmd.calls.find((c) => c.includes('ls-remote'));
    expect(cmd).toContain('https://github.com/perfectuser21/cecelia.git');
    expect(cmd).not.toMatch(/ls-remote --heads origin\b/);
  });

  it('B-05: derive 后果，正确观测不产生 gan_no_push_streak 致盲观测才误判', async () => {
    // 构造两轮 proposer（均真推、分支真推进）的决策日志。
    const launch = (hop, attemptId) => ({
      hop, action: 'effect:attempt_launched', observed: {},
      detail: { dispatch_hop: hop - 1, dispatch_action: 'spawn:proposer', attempt_id: attemptId, role: 'proposer' },
    });
    const callback = (hop, attemptId) => ({
      hop, action: 'verdict:attempt_callback', observed: {},
      detail: { attempt_id: attemptId, role: 'proposer', status: 'completed' },
    });
    // 正确 remote 观测：intent 记录到真推进值（0→1→2）。
    const goodLog = [
      { hop: 1, action: 'spawn:proposer', observed: { proposeBranchRn: 0 }, detail: null },
      launch(2, 'att-1'), callback(3, 'att-1'),
      { hop: 4, action: 'spawn:proposer', observed: { proposeBranchRn: 1 }, detail: null },
      launch(5, 'att-2'), callback(6, 'att-2'),
    ];
    // 致盲 origin 观测：intent 全记 0（origin 看不到已推分支）。
    const blindLog = goodLog.map((r) => (
      r.action === 'spawn:proposer' ? { ...r, observed: { proposeBranchRn: 0 } } : r
    ));

    const goodCounters = deriveCounters(goodLog, { proposeBranchMaxRn: 2 });
    const blindCounters = deriveCounters(blindLog, { proposeBranchMaxRn: 0 });
    expect(goodCounters.noPushStreak).toBe(0);
    expect(blindCounters.noPushStreak).toBeGreaterThanOrEqual(2); // 致盲 → 误判条件成立（锚点）

    const baseObserved = {
      run: {}, task: {}, prdExists: true,
      contract: { approved: false, id: null }, pr: null,
      inflight: { containers: [], host_pids: [], attempts: [] }, lastAgentExit: null,
      ganLatestRoundVerdict: null, generatorSpawned: false,
      evaluateVerdict: null, judgeVerdict: null, reviewRequired: false, reviewApproved: false,
    };
    const good = derive({
      ...baseObserved, proposeBranchRn: 2,
      counters: { hops: 6, fixRound: 0, pollCount: 0, noPushStreak: goodCounters.noPushStreak, noVerdictStreak: 0, ganCostUsd: 0 },
    });
    expect(good.reason).not.toBe('gan_no_push_streak');
    expect(good.action).not.toBe('mark_failed');
  });
});
