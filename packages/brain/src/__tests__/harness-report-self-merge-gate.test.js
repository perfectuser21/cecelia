/**
 * reportNode 自合 verdict gate（合并门旁路修复）
 *
 * 背景：#3398 假摔修复让 reportNode 自合任何 CI 绿但未合的 PR，然后 computedVerdict=所有 merged?PASS:FAIL，
 * 全程不看裁判 verdict → CI 绿但裁判 FAIL/未跑的 PR 被强合算 PASS（裁判旁路）。
 *
 * 修复：自合前校验 sub_task.evaluate_verdict==='PASS' 才允许自合（与子图 routeAfterEvaluate 同判据）。
 *
 * SC-403: evaluate_verdict=FAIL + CI绿未合 → 不自合，verdict FAIL
 * SC-404: evaluate_verdict=PASS + CI绿未合 → 自合，verdict PASS（保住 #3398 假摔修复）
 * SC-405: evaluate_verdict=null（未透传）+ CI绿未合 → 不自合，verdict FAIL
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => '') }));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn(), topologicalOrder: vi.fn(), detectCycle: vi.fn(), nextRunnableTask: vi.fn() }));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn(), harnessSubTaskBranchName: vi.fn(() => 'cp-test-ws-x'), harnessContractThreadSuffix: vi.fn(() => '') }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../harness-container-cleanup.js', () => ({ killInitiativeContainers: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@langchain/langgraph', () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class { addNode() { return this; } addEdge() { return this; } addConditionalEdges() { return this; } compile() { return { invoke: vi.fn() }; } },
    Annotation, START: '__start__', END: '__end__', interrupt: vi.fn(), Command: class {}, MemorySaver: class {},
  };
});

import { reportNode } from '../workflows/harness-initiative.graph.js';

const INIT_ID = '1fe4f146-4d79-426f-b010-a98e3efb6d3a';
const PR_URL = 'https://github.com/perfectuser21/infrastructure/pull/50';

function makeMockPool() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn().mockResolvedValue(client) };
  return { pool, client };
}
function getInitiativeRunsPhase(client) {
  for (const call of client.query.mock.calls) {
    const sql = String(call[0] || '');
    if (sql.includes('initiative_runs') && sql.includes('SET phase')) return call[1]?.[1];
  }
  return null;
}

describe('reportNode 自合 verdict gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SC-403: evaluate_verdict=FAIL + CI绿未合 → 不自合，verdict FAIL', async () => {
    const { pool, client } = makeMockPool();
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL, evaluate_verdict: 'FAIL' }],
    };
    await reportNode(state, { pool, execFile, _checkPrMerged: checkPrMerged });
    expect(execFile).not.toHaveBeenCalled();
    expect(getInitiativeRunsPhase(client)).toBe('failed');
  });

  it('SC-404: evaluate_verdict=PASS + CI绿未合 → 自合，verdict PASS（保住假摔修复）', async () => {
    const { pool, client } = makeMockPool();
    const execFile = vi.fn().mockResolvedValue({ stdout: 'merged', stderr: '' });
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL, evaluate_verdict: 'PASS' }],
    };
    await reportNode(state, { pool, execFile, _checkPrMerged: checkPrMerged });
    expect(execFile).toHaveBeenCalledWith('gh', expect.arrayContaining(['pr', 'merge', PR_URL]), expect.anything());
    expect(getInitiativeRunsPhase(client)).toBe('done');
  });

  it('SC-405: evaluate_verdict=null（未透传）+ CI绿未合 → 不自合，verdict FAIL', async () => {
    const { pool, client } = makeMockPool();
    const execFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const checkPrMerged = vi.fn().mockResolvedValue(false);
    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL, evaluate_verdict: null }],
    };
    await reportNode(state, { pool, execFile, _checkPrMerged: checkPrMerged });
    expect(execFile).not.toHaveBeenCalled();
    expect(getInitiativeRunsPhase(client)).toBe('failed');
  });
});
