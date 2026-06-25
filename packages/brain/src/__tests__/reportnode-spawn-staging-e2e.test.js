/**
 * 阶段2 Slice1 修正（决策 C）— reportNode 不再派生 staging_e2e
 *
 * #3425 曾在 reportNode 按 per-initiative 无去重派生 staging_e2e（取 first sub_task 的 pr_url），
 * 偏离 spec §3 "sub_task 合并后"（per-merge）原义。本修正把派生挪到 mergePrNode（per-merge，
 * 两条 merged 分支 + pr_url 幂等，见 slice1-permerge-correction.test.js）。
 *
 * 本测试退化为**回归守卫**：reportNode 在任何 verdict 下都不得再派生 staging_e2e
 * （防 per-initiative 无去重派生复活）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => '') }));
vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn(), topologicalOrder: vi.fn(), detectCycle: vi.fn(),
}));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
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

function findStagingE2eInsert(pool) {
  return pool.query.mock.calls.find(([sql]) =>
    String(sql || '').includes('INSERT INTO tasks') && String(sql || '').includes("'staging_e2e'"));
}

describe('reportNode 不派生 staging_e2e（回归守卫 · 决策 C）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('全部 sub_task merged（verdict PASS）→ reportNode 仍不派 staging_e2e（已挪到 mergePrNode）', async () => {
    const { pool } = makeMockPool();
    const state = {
      initiativeId: INIT_ID,
      task: { title: 'feat X', payload: { journey_id: 'line-01' } },
      sub_tasks: [{ id: 'ws1', status: 'merged', pr_url: PR_URL }],
    };

    await reportNode(state, { pool, _checkPrMerged: vi.fn().mockResolvedValue(true) });

    expect(findStagingE2eInsert(pool)).toBeFalsy();
  });

  it('PR 未 merged（verdict FAIL）→ reportNode 不派 staging_e2e', async () => {
    const { pool } = makeMockPool();
    const state = {
      initiativeId: INIT_ID,
      task: { title: 'feat X', payload: {} },
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL }],
    };

    await reportNode(state, { pool, _checkPrMerged: vi.fn().mockResolvedValue(false) });

    expect(findStagingE2eInsert(pool)).toBeFalsy();
  });
});
