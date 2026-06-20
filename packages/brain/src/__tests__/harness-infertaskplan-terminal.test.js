/**
 * Regression test: inferTaskPlanNode 不可恢复失败（proposer 产物坏）→ terminal failed，
 * 而不是无限 fresh-start。
 *
 * 根因（生产 run 4225330d，2026-06-13）：proposer 产出的 task-plan.json 坏（解析失败 / tasks 为空），
 * inferTaskPlanNode 旧码 parse-fail return {}（或透传空 tasks）→ dbUpsertNode 抛
 * "taskPlan.tasks required"（非终态 error）→ task 留 status='in_progress'。
 * harness-watchdog 只扫 `task_type='harness_initiative' AND status='in_progress'`，于是把它反复
 * fresh-start，重跑 planner+GAN 烧穿 execution_attempts（实测 3 次 attempt 全废）。
 * 重跑解决不了坏的 proposer 产物 —— 必须 terminal fail loud。
 *
 * 修复：inferTaskPlanNode 对「无 propose_branch / 解析失败 / 空 tasks」标 status='failed'
 * （移出 watchdog 扫描范围）+ 返回 error.terminal=true（resume 路径也判终态）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: [] }),
  topologicalOrder: vi.fn(),
  detectCycle: vi.fn(),
}));
vi.mock('../lib/git-fence.js', () => ({
  fetchAndShowOriginFile: vi.fn(),
}));
vi.mock('../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(), bootstrapE2E: vi.fn(), teardownE2E: vi.fn(), normalizeAcceptance: vi.fn(),
}));
vi.mock('@langchain/langgraph', () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class { addNode() { return this; } addEdge() { return this; } addConditionalEdges() { return this; } compile() { return { invoke: vi.fn() }; } },
    Annotation, START: '__start__', END: '__end__',
    Send: class { constructor(n, s) { this.node = n; this.state = s; } },
    MemorySaver: class {},
  };
});
vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: class { constructor(pool) { this.pool = pool; } setup() { return Promise.resolve(); } static fromConnString() { return { setup: () => Promise.resolve() }; } },
}));
vi.mock('../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn(), buildHarnessGanGraph: vi.fn() }));
vi.mock('../orchestrator/pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn().mockResolvedValue({}) }));
vi.mock('../harness-shared.js', () => ({ parseDockerOutput: vi.fn((x) => x), loadSkillContent: vi.fn(() => 'S'), readBrainResult: vi.fn().mockResolvedValue({}) }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('./harness-task.graph.js', () => ({ buildHarnessTaskGraph: vi.fn(() => ({ compile: vi.fn(() => ({ invoke: vi.fn() })) })) }));
vi.mock('../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn(), harnessTaskWorktreePath: vi.fn(), harnessSubTaskWorktreePath: vi.fn(), DEFAULT_BASE_REPO: '/mock' }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));

import { parseTaskPlan } from '../harness-dag.js';
import { fetchAndShowOriginFile } from '../lib/git-fence.js';
import { inferTaskPlanNode } from '../workflows/harness-initiative.graph.js';

function mkPool() {
  return { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
}

describe('inferTaskPlanNode — 不可恢复失败标 terminal failed（防无限 fresh-start）', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('解析成功但 tasks 为空 → terminal error + 标 task status=failed（不进 dbUpsert "tasks required" → 不 fresh-start）', async () => {
    fetchAndShowOriginFile.mockResolvedValue('{"tasks":[]}');
    parseTaskPlan.mockReturnValue({ initiative_id: 'init-1', tasks: [] });
    const pool = mkPool();
    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'cp-harness-propose-r1-abcd1234' },
      worktreePath: undefined, // 跳过 B32 真 git
      task: { id: '11111111-1111-1111-1111-111111111111', payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-1',
      initiative_run_id: '22222222-2222-2222-2222-222222222222',
    };

    const result = await inferTaskPlanNode(state, { pool });

    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('infer_task_plan');
    expect(result.error.terminal).toBe(true);
    // 标 task failed（移出 watchdog in_progress 扫描）
    const failUpdate = pool.query.mock.calls.find(
      (c) => /UPDATE tasks SET status='failed'/.test(c[0])
    );
    expect(failUpdate).toBeTruthy();
    expect(failUpdate[1]).toContain('11111111-1111-1111-1111-111111111111');
  });

  it('parseTaskPlan 抛错（产物坏）→ terminal error + 标 failed', async () => {
    fetchAndShowOriginFile.mockResolvedValue('not json');
    parseTaskPlan.mockImplementation(() => { throw new Error('no json block'); });
    const pool = mkPool();
    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'cp-harness-propose-r1-abcd1234' },
      worktreePath: undefined,
      task: { id: '33333333-3333-3333-3333-333333333333', payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-2',
    };

    const result = await inferTaskPlanNode(state, { pool });

    expect(result.error?.terminal).toBe(true);
    expect(pool.query.mock.calls.some((c) => /status='failed'/.test(c[0]))).toBe(true);
  });

  it('无 propose_branch → terminal error + 标 failed', async () => {
    const pool = mkPool();
    const state = {
      taskPlan: null,
      ganResult: {},
      worktreePath: undefined,
      task: { id: '44444444-4444-4444-4444-444444444444' },
      initiativeId: 'init-3',
    };

    const result = await inferTaskPlanNode(state, { pool });

    expect(result.error?.node).toBe('infer_task_plan');
    expect(result.error?.terminal).toBe(true);
    expect(pool.query.mock.calls.some((c) => /status='failed'/.test(c[0]))).toBe(true);
  });

  it('正常：tasks 非空 → 返回 taskPlan，不标 failed', async () => {
    fetchAndShowOriginFile.mockResolvedValue('{"tasks":[{"id":"t1"}]}');
    parseTaskPlan.mockReturnValue({ initiative_id: 'pending', tasks: [{ id: 't1', title: 'T1' }] });
    const pool = mkPool();
    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'cp-harness-propose-r1-abcd1234' },
      worktreePath: undefined,
      task: { id: '55555555-5555-5555-5555-555555555555', payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-4',
    };

    const result = await inferTaskPlanNode(state, { pool });

    expect(result.error).toBeUndefined();
    expect(result.taskPlan?.tasks).toHaveLength(1);
    expect(result.taskPlan.initiative_id).toBe('init-4'); // pending → 覆盖为权威
    expect(pool.query.mock.calls.some((c) => /status='failed'/.test(c[0]))).toBe(false);
  });

  it('已有 tasks → 短路 passthrough，不读分支不标 failed', async () => {
    const pool = mkPool();
    const state = { taskPlan: { tasks: [{ id: 't1' }] }, ganResult: { propose_branch: 'x' } };
    const result = await inferTaskPlanNode(state, { pool });
    expect(result).toEqual({});
    expect(fetchAndShowOriginFile).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('调 parseTaskPlan 时把 state.initiativeId 作为系统权威注入（修 run ad01edbe 空 iid 致 terminal）', async () => {
    fetchAndShowOriginFile.mockResolvedValue('{"initiative_id":"","tasks":[{"id":"t1"}]}');
    parseTaskPlan.mockReturnValue({ initiative_id: 'init-9', tasks: [{ id: 't1' }] });
    const pool = mkPool();
    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'cp-harness-propose-r1-abcd1234' },
      worktreePath: undefined,
      task: { id: '66666666-6666-6666-6666-666666666666', payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-9',
    };

    await inferTaskPlanNode(state, { pool });

    // 修复点：proposer 产物的 initiative_id 不可信，必须把系统已知值传给 parseTaskPlan 先注入再校验
    expect(parseTaskPlan).toHaveBeenCalledWith(expect.any(String), { initiativeId: 'init-9' });
  });
});
