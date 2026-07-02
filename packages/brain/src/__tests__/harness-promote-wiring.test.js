/**
 * harness-promote-wiring.test.js — A3 reportNode 接线测试。
 * PASS → promoteToRegression 被调；FAIL → 不调；promote 抛错 → reportNode 仍返回 report_path。
 *
 * mock 模式复用 harness-report-merge-recheck.test.js（graph 依赖全 mock）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { promoteMock } = vi.hoisted(() => ({
  promoteMock: vi.fn(async () => ({ ok: true, dbWritten: true })),
}));

vi.mock('../harness-promote-regression.js', () => ({
  promoteToRegression: promoteMock,
  default: { promoteToRegression: promoteMock },
}));
vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => ''),
}));
vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn(), topologicalOrder: vi.fn(),
  detectCycle: vi.fn(),
}));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../harness-container-cleanup.js', () => ({ killInitiativeContainers: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../okr-initiative-sync.js', () => ({ syncOkrInitiativeStatus: vi.fn() }));
vi.mock('../staging-promote.js', () => ({
  spawnHarnessReport: vi.fn(),
  REPORT_KIND: { FAILURE: 'failure' },
}));
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

function makePool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  };
}

const baseState = {
  initiativeId: 'bd7e251c-0000-0000-0000-000000000001',
  task: { id: 'bd7e251c-0000-0000-0000-000000000001', title: 't', payload: { journey_id: 'j1', feature_id: 'f1' } },
  sprintDir: 'sprints/0702-demo',
  worktreePath: '/tmp/wt',
  sub_tasks: [{ id: 'ws1', status: 'merged', pr_url: 'https://github.com/x/y/pull/9', evaluate_verdict: 'PASS' }],
};

describe('reportNode × promoteToRegression 接线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computedVerdict=PASS（全 merged）→ promoteToRegression 被调一次', async () => {
    const r = await reportNode(baseState, { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
    expect(promoteMock).toHaveBeenCalledTimes(1);
    const [, params] = promoteMock.mock.calls[0];
    expect(params.task.id).toBe(baseState.task.id);
    expect(params.sprintDir).toBe('sprints/0702-demo');
  });

  it('computedVerdict=FAIL（有未 merged）→ 不调 promote', async () => {
    const failState = { ...baseState, sub_tasks: [{ id: 'ws1', status: 'failed', evaluate_verdict: 'FAIL' }] };
    await reportNode(failState, { pool: makePool(), _checkPrMerged: async () => false });
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('promote 抛错 → reportNode 不炸，仍返回 report_path', async () => {
    promoteMock.mockRejectedValueOnce(new Error('promotion boom'));
    const r = await reportNode(baseState, { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
  });
});
