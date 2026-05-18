import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';

vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn(async () => new MemorySaver()),
  _resetPgCheckpointerForTests: () => {},
}));
vi.mock('../../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/wt/test'),
}));
vi.mock('../../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn(async () => 'ghp_test'),
}));
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn() },
  readFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

describe('harness-initiative.graph — planner session reconnect', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('InitiativeState 含 planner_session 字段，默认值 null', async () => {
    const { InitiativeState } = await import('../../workflows/harness-initiative.graph.js');
    const state = InitiativeState.spec;
    expect('planner_session' in state).toBe(true);
  });

  it('InitiativeState 含 evaluator_session 字段，默认值 null', async () => {
    const { InitiativeState } = await import('../../workflows/harness-initiative.graph.js');
    const state = InitiativeState.spec;
    expect('evaluator_session' in state).toBe(true);
  });

  it('runPlannerNode fresh start: executor 被调，结果含 planner_session', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      exit_code: 0, stdout: '```json\n{"initiatives":[]}\n```', container: 'cecelia-task-test123',
    });
    readFile.mockResolvedValue('uuid-session-abc\n');
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      cb(new Error('No such object'), '', '');
    });

    const { runPlannerNode } = await import('../../workflows/harness-initiative.graph.js');
    const result = await runPlannerNode(
      { task: { id: 't1', description: 'test' }, initiativeId: 'init1', worktreePath: '/wt/test', githubToken: 'gh' },
      { executor: mockExecutor }
    );

    expect(mockExecutor).toHaveBeenCalledOnce();
    expect(result.planner_session).toBeDefined();
    expect(result.planner_session.container).toBe('cecelia-task-test123');
  });

  it('runPlannerNode 重入: planner_session 存在且容器 exited_ok → 不调 executor', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (typeof opts === 'function') cb = opts;
      cb(null, 'exited:0\n', '');
    });
    readFile.mockResolvedValue('cached prd content');
    const mockExecutor = vi.fn();

    const { runPlannerNode } = await import('../../workflows/harness-initiative.graph.js');
    const result = await runPlannerNode(
      {
        task: { id: 't1', description: 'test' },
        initiativeId: 'init1',
        worktreePath: '/wt/test',
        githubToken: 'gh',
        planner_session: { container: 'cecelia-task-existing', session_uuid: 'old-uuid' },
      },
      { executor: mockExecutor }
    );

    expect(mockExecutor).not.toHaveBeenCalled();
    expect(result.plannerOutput).toBeTruthy();
  });
});

describe('harness-gan.graph — GanContractState session_map', () => {
  it('GanContractState 含 session_map 字段，默认值 {}', async () => {
    const { GanContractState } = await import('../../workflows/harness-gan.graph.js');
    expect('session_map' in GanContractState.spec).toBe(true);
  });

  it('session_map reducer 是 shallow merge（不丢旧轮）', async () => {
    const { GanContractState } = await import('../../workflows/harness-gan.graph.js');
    const ann = GanContractState.spec.session_map;
    const after1 = ann.reducer({}, { 1: { container: 'c1', session_uuid: 'u1' } });
    const after2 = ann.reducer(after1, { 2: { container: 'c2', session_uuid: 'u2' } });
    expect(after2[1]).toEqual({ container: 'c1', session_uuid: 'u1' });
    expect(after2[2]).toEqual({ container: 'c2', session_uuid: 'u2' });
  });
});
