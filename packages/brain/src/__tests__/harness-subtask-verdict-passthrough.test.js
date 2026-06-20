/**
 * runSubTaskNode 透传 evaluate_verdict
 *
 * 背景：harness 子图（harness-task.graph.js）内部有 evaluate_verdict 状态，但 runSubTaskNode
 * 返回的 sub_task 对象（harness-initiative.graph.js）没透传它 → reportNode 自合 gate 拿不到裁判
 * verdict → CI 绿但裁判 FAIL 的 PR 被算 PASS（合并门旁路）。本测试钉死透传。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => '') }));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn(), topologicalOrder: vi.fn(), detectCycle: vi.fn() }));
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

import { runSubTaskNode } from '../workflows/harness-initiative.graph.js';

const INIT_ID = '1fe4f146-4d79-426f-b010-a98e3efb6d3a';

describe('runSubTaskNode 透传 evaluate_verdict', () => {
  beforeEach(() => vi.clearAllMocks());

  it('子图终态带 evaluate_verdict=PASS → 返回的 sub_task 透传该字段', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() };
    const compiledTaskGraph = {
      invoke: vi.fn().mockResolvedValue({ status: 'merged', pr_url: 'https://x/pull/1', evaluate_verdict: 'PASS' }),
    };
    const state = { initiativeId: INIT_ID, sub_task: { id: 'ws1', title: 't', payload: {} } };
    const out = await runSubTaskNode(state, { pool, compiledTaskGraph, waitMs: 0 });
    expect(out.sub_tasks[0].evaluate_verdict).toBe('PASS');
    expect(out.sub_tasks[0].status).toBe('merged');
    expect(out.sub_tasks[0].pr_url).toBe('https://x/pull/1');
  });

  it('子图终态带 evaluate_verdict=FAIL → 透传 FAIL', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() };
    const compiledTaskGraph = {
      invoke: vi.fn().mockResolvedValue({ status: 'failed', pr_url: 'https://x/pull/2', evaluate_verdict: 'FAIL' }),
    };
    const state = { initiativeId: INIT_ID, sub_task: { id: 'ws1', title: 't', payload: {} } };
    const out = await runSubTaskNode(state, { pool, compiledTaskGraph, waitMs: 0 });
    expect(out.sub_tasks[0].evaluate_verdict).toBe('FAIL');
    expect(out.sub_tasks[0].status).toBe('failed');
    expect(out.sub_tasks[0].pr_url).toBe('https://x/pull/2');
  });
});
