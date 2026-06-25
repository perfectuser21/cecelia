/**
 * 阶段2 Slice1 — reportNode 派生 staging_e2e 任务
 *
 * sub_task 合并后（computedVerdict=PASS 等价于全部 merged），reportNode 应在 tasks 表
 * 派生一个 task_type='staging_e2e' 的任务（独立于本 langgraph）。FAIL（无 merged 产物）不派。
 *
 * SC-1: 全部 sub_task merged → verdict PASS → 派 staging_e2e（payload 带 initiative_id + pr_url）
 * SC-2: sub_task 未 merged 且 PR 真未 merged → verdict FAIL → 不派 staging_e2e
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

// 从 pool.query 里抓 staging_e2e 的 INSERT INTO tasks 调用
function findStagingE2eInsert(pool) {
  return pool.query.mock.calls.find(([sql]) =>
    String(sql || '').includes('INSERT INTO tasks') && String(sql || '').includes("'staging_e2e'"));
}

describe('reportNode 派生 staging_e2e', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SC-1: 全部 sub_task merged → 派 staging_e2e（payload 带 initiative_id + pr_url）', async () => {
    const { pool } = makeMockPool();
    const state = {
      initiativeId: INIT_ID,
      task: { title: 'feat X', payload: { journey_id: 'line-01' } },
      sub_tasks: [{ id: 'ws1', status: 'merged', pr_url: PR_URL }],
    };

    await reportNode(state, { pool, _checkPrMerged: vi.fn().mockResolvedValue(true) });

    const insert = findStagingE2eInsert(pool);
    expect(insert).toBeTruthy();
    const payload = JSON.parse(insert[1][2]);
    expect(payload.initiative_id).toBe(INIT_ID);
    expect(payload.pr_url).toBe(PR_URL);
    expect(payload.journey_id).toBe('line-01');
  });

  it('SC-2: PR 真未 merged → verdict FAIL → 不派 staging_e2e', async () => {
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
