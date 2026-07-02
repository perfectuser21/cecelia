/**
 * harness-handoff-wiring.test.js — 方案B reportNode/plannerNode 接线测试。
 * PASS 与 FAIL 都产 handoff；handoff 抛错 → reportNode 仍返回 report_path。
 * mock 前导复制 harness-promote-wiring.test.js。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { buildMock, saveMock, getRecentMock, formatMock } = vi.hoisted(() => ({
  buildMock: vi.fn((x) => ({ ...x, schema_version: 1, created_at: '2026-07-02T00:00:00Z' })),
  saveMock: vi.fn(async () => ({ dbWritten: true, mirrorPath: null })),
  getRecentMock: vi.fn(async () => []),
  formatMock: vi.fn(() => ''),
}));

vi.mock('../handoff.js', () => ({
  buildHandoff: buildMock,
  saveHandoff: saveMock,
  getRecentHandoffs: getRecentMock,
  formatHandoffsForPrompt: formatMock,
}));

// ↓↓↓ 以下 vi.mock 清单逐行复制 harness-promote-wiring.test.js
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

import { reportNode, runPlannerNode } from '../workflows/harness-initiative.graph.js';

function makePool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  };
}

const INIT_ID = 'dcdbf10f-0000-0000-0000-000000000001';
function makeState(subStatus) {
  return {
    initiativeId: INIT_ID,
    task: { id: INIT_ID, title: 'handoff-demo', payload: { journey_id: 'j1', feature_id: 'f1' } },
    sprintDir: 'sprints/0702-demo',
    worktreePath: '/tmp/wt',
    sub_tasks: [{ id: 'ws1', status: subStatus, pr_url: 'https://github.com/x/y/pull/9', evaluate_verdict: 'PASS' }],
  };
}

describe('reportNode handoff 接线', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('PASS：saveHandoff 被调，verdict=PASS，done 含 ws1', async () => {
    const r = await reportNode(makeState('merged'), { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const built = buildMock.mock.calls[0][0];
    expect(built.verdict).toBe('PASS');
    expect(built.task_id).toBe(INIT_ID);
    expect(built.journey_id).toBe('j1');
    expect(built.done.join()).toContain('ws1');
  });

  it('FAIL：也产 handoff，not_done 含 ws1', async () => {
    const state = makeState('failed');
    state.sub_tasks[0].evaluate_verdict = 'FAIL';
    const r = await reportNode(state, { pool: makePool(), _checkPrMerged: async () => false });
    expect(r.report_path).toBeTruthy();
    expect(saveMock).toHaveBeenCalledTimes(1);
    const built = buildMock.mock.calls[0][0];
    expect(built.verdict).toBe('FAIL');
    expect(built.not_done.join()).toContain('ws1');
  });

  it('handoff 抛错 → reportNode 不受影响返回 report_path', async () => {
    saveMock.mockRejectedValueOnce(new Error('boom'));
    const r = await reportNode(makeState('merged'), { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
  });
});

describe('runPlannerNode handoff 注入', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // stub fetch：runHistoryText 块会 fetch localhost:5221，stub 掉消除对本机 brain 的隐性网络依赖
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  });

  function plannerState() {
    return {
      initiativeId: INIT_ID,
      task: { id: INIT_ID, title: 't', payload: { journey_id: 'j1', sprint_dir: 'sprints/x' } },
      worktreePath: '/tmp/wt',
    };
  }

  it('有 handoff 时 prompt 含注入段', async () => {
    getRecentMock.mockResolvedValueOnce([{ id: 'prev', title: 'p', handoff: { verdict: 'PASS' } }]);
    formatMock.mockReturnValueOnce('\n\n## 最近 Handoff（本 line 交接）\n### Handoff 1: p（verdict=PASS）');
    const spawnDetached = vi.fn(async () => ({}));
    // mock 的 interrupt() 返回 undefined → runPlannerNode 在 spawn 后抛错/返回 error，此处只断言 spawn 收到的 prompt
    await runPlannerNode(plannerState(), { spawnDetached, pool: makePool() }).catch(() => {});
    expect(getRecentMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ journeyId: 'j1', excludeTaskId: INIT_ID }));
    expect(spawnDetached).toHaveBeenCalled();
    expect(spawnDetached.mock.calls[0][0].prompt).toContain('## 最近 Handoff');
  });

  it('getRecentHandoffs 抛错 → spawn 照常，prompt 无注入段', async () => {
    getRecentMock.mockRejectedValueOnce(new Error('db down'));
    const spawnDetached = vi.fn(async () => ({}));
    // mock 的 interrupt() 返回 undefined → runPlannerNode 在 spawn 后抛错/返回 error，此处只断言 spawn 收到的 prompt
    await runPlannerNode(plannerState(), { spawnDetached, pool: makePool() }).catch(() => {});
    expect(spawnDetached).toHaveBeenCalled();
    expect(spawnDetached.mock.calls[0][0].prompt).not.toContain('## 最近 Handoff');
  });
});
