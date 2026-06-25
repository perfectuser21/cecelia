import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn(), loadSkillContent: vi.fn(() => '') }));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn(), topologicalOrder: vi.fn(), detectCycle: vi.fn() }));
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

const INIT = '1fe4f146-4d79-426f-b010-a98e3efb6d3a';

function mockPool() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  const pool = { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn().mockResolvedValue(client) };
  return { pool, client };
}
function reportSpawn(pool) {
  return pool.query.mock.calls.find(([sql]) =>
    /INSERT INTO tasks/i.test(String(sql || '')) && String(sql || '').includes('harness_report'));
}

// ──────────────────────────────────────────────────────────────────────────
// Slice 3 三态（决策 B）：report 后移
// - PASS：reportNode 不派 report（等 promote 完成由 runner/confirm 派）
// - FAIL：reportNode 派失败报告（不饿死）
// - 生命周期闭合（phase/task status/容器清理）仍在 merge 时
// ──────────────────────────────────────────────────────────────────────────

describe('Slice3: reportNode report 后移（三态）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PASS → reportNode 不派 harness_report（等 promote 完成才出成功证书）', async () => {
    const { pool } = mockPool();
    await reportNode({
      initiativeId: INIT, final_e2e_verdict: 'PASS', sprintDir: 'sprints/x',
      sub_tasks: [{ id: 's1', status: 'merged', pr_url: 'https://pr/1' }],
      task: { title: 'feat X', payload: { journey_id: 'j1' } },
    }, { pool, _checkPrMerged: vi.fn().mockResolvedValue(true) });
    expect(reportSpawn(pool)).toBeFalsy();
  });

  it('FAIL → reportNode 派失败报告 report_kind=failure（不饿死）', async () => {
    const { pool } = mockPool();
    await reportNode({
      initiativeId: INIT, final_e2e_verdict: 'FAIL', sprintDir: 'sprints/x',
      sub_tasks: [{ id: 's1', status: 'pr_open', pr_url: 'https://pr/1' }],
      task: { title: 'feat X', payload: {} },
    }, { pool, _checkPrMerged: vi.fn().mockResolvedValue(false) });
    const ins = reportSpawn(pool);
    expect(ins).toBeTruthy();
    const payload = JSON.parse(ins[1].find((p) => typeof p === 'string' && p.includes('report_kind')));
    expect(payload.report_kind).toBe('failure');
  });

  it('生命周期闭合仍在 merge 时：UPDATE initiative_runs phase + tasks.status（client.query）', async () => {
    const { pool, client } = mockPool();
    await reportNode({
      initiativeId: INIT, final_e2e_verdict: 'PASS', sprintDir: 'sprints/x',
      sub_tasks: [{ id: 's1', status: 'merged', pr_url: 'https://pr/1' }],
      task: { title: 'feat X', payload: {} },
    }, { pool, _checkPrMerged: vi.fn().mockResolvedValue(true) });
    const phaseUpd = client.query.mock.calls.find(([sql]) => /UPDATE initiative_runs SET phase/i.test(String(sql || '')));
    const taskUpd = client.query.mock.calls.find(([sql]) => /UPDATE tasks SET status/i.test(String(sql || '')));
    expect(phaseUpd).toBeTruthy(); // 生命周期没被挪走
    expect(taskUpd).toBeTruthy();
  });
});
