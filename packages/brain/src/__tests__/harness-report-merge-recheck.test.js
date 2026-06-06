/**
 * reportNode merge-race 误报修复
 *
 * 背景：reportNode 用 `state.sub_tasks.every(s => s.status === 'merged')` 推 Final E2E verdict。
 * 实测 sub_task PR 从创建到 auto-merge 约 10 分钟（CI + squash），reportNode 在 merge 完成前
 * 抢跑 → sub_tasks 仍非 merged → 误判 'Final E2E FAIL'（failed_scenarios 为空），但 PR 实际已
 * merged、代码正确（PR#50 实证）。
 *
 * 修复：reportNode 计算 verdict 前，对有 pr_url 但 status≠merged 的 sub_task 回查 GitHub 真实
 * merge 状态（_checkPrMerged 可注入），已 merge 则纠正为 merged，消除 race 误报。
 *
 * SC-401: sub_task status=pr_open 但 PR 实际已 merged → 回查纠正 → verdict PASS（phase='done'）
 * SC-402: sub_task status=pr_open 且 PR 真未 merged → 不纠正 → verdict FAIL（phase='failed'）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => ''),
}));
vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn(), topologicalOrder: vi.fn(),
  detectCycle: vi.fn(), nextRunnableTask: vi.fn(),
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
    Annotation, START: '__start__', END: '__end__', interrupt: vi.fn(), Command: class {},
    MemorySaver: class {},
  };
});

import { reportNode } from '../workflows/harness-initiative.graph.js';

const INIT_ID = '1fe4f146-4d79-426f-b010-a98e3efb6d3a';
const PR_URL = 'https://github.com/perfectuser21/infrastructure/pull/50';

function makeMockPool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue(client),
  };
  return { pool, client };
}

// 从 client.query 调用里抓 UPDATE initiative_runs 的 phase 参数（params[1]）
function getInitiativeRunsPhase(client) {
  for (const call of client.query.mock.calls) {
    const sql = String(call[0] || '');
    if (sql.includes('initiative_runs') && sql.includes('SET phase')) {
      return call[1]?.[1];
    }
  }
  return null;
}

describe('reportNode merge-race 回查', () => {
  beforeEach(() => vi.clearAllMocks());

  it('SC-401: PR 实际已 merged（status 还是 pr_open）→ verdict PASS（phase=done）', async () => {
    const { pool, client } = makeMockPool();
    const checkPrMerged = vi.fn().mockResolvedValue(true);

    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL }],
      // final_e2e_verdict 未设 → 走 sub_tasks 推导路径
    };

    await reportNode(state, { pool, _checkPrMerged: checkPrMerged });

    expect(checkPrMerged).toHaveBeenCalledWith(PR_URL);
    expect(getInitiativeRunsPhase(client)).toBe('done');
  });

  it('SC-402: PR 真未 merged → verdict FAIL（phase=failed）', async () => {
    const { pool, client } = makeMockPool();
    const checkPrMerged = vi.fn().mockResolvedValue(false);

    const state = {
      initiativeId: INIT_ID,
      sub_tasks: [{ id: 'ws1', status: 'pr_open', pr_url: PR_URL }],
    };

    await reportNode(state, { pool, _checkPrMerged: checkPrMerged });

    expect(getInitiativeRunsPhase(client)).toBe('failed');
  });
});
