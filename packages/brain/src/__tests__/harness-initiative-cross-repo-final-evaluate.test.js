/**
 * harness-initiative-cross-repo-final-evaluate.test.js
 *
 * TDD — RED phase: cross-repo final_evaluate should mount the sub-task worktree
 * (where the external repo code lives) instead of the Cecelia initiative worktree.
 *
 * Bug fixed: when base_repo is zenithjoy, final_evaluate was mounting the Cecelia
 * initiative worktree, causing ARTIFACT checks for external repo files to always FAIL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

vi.mock('../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: [] }),
  topologicalOrder: vi.fn(),
  detectCycle: vi.fn(),
  nextRunnableTask: vi.fn(),
}));

vi.mock('../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(),
  bootstrapE2E: vi.fn(),
  teardownE2E: vi.fn(),
  normalizeAcceptance: vi.fn(),
}));

vi.mock('@langchain/langgraph', () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class { addNode() { return this; } addEdge() { return this; } addConditionalEdges() { return this; } compile() { return { invoke: vi.fn() }; } },
    Annotation,
    START: '__start__',
    END: '__end__',
    Send: class { constructor(n, s) { this.node = n; this.state = s; } },
    MemorySaver: class {},
  };
});

vi.mock('@langchain/langgraph-checkpoint-postgres', () => ({
  PostgresSaver: class { static fromConnString() { return { setup: vi.fn() }; } },
}));

vi.mock('../harness-gan-graph.js', () => ({
  runGanContractGraph: vi.fn(),
  buildHarnessGanGraph: vi.fn(),
}));

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({}),
}));

vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn((x) => x),
  loadSkillContent: vi.fn(() => 'SKILL_CONTENT'),
  readBrainResult: vi.fn().mockResolvedValue({ verdict: 'PASS' }),
}));

vi.mock('../spawn/index.js', () => ({
  spawn: vi.fn(),
}));

vi.mock('./harness-task.graph.js', () => ({
  buildHarnessTaskGraph: vi.fn(() => ({
    compile: vi.fn(() => ({ invoke: vi.fn() })),
  })),
}));

vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(),
  harnessTaskWorktreePath: vi.fn((taskId) => `/mock-wt/task-${taskId}`),
  harnessSubTaskWorktreePath: vi.fn((initiativeId, logicalId) => `/mock-wt/task-${initiativeId.slice(0, 8)}-${logicalId}`),
  DEFAULT_BASE_REPO: '/mock-base',
}));

vi.mock('../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn(),
}));

import { readBrainResult } from '../harness-shared.js';
import { finalEvaluateDispatchNode } from '../workflows/harness-initiative.graph.js';

describe('finalEvaluateDispatchNode — cross-repo worktree selection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readBrainResult).mockResolvedValue({ verdict: 'PASS' });
  });

  it('same-repo sprint: executor called with state.worktreePath', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({ exit_code: 0, timed_out: false, stderr: '' });

    const state = {
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'aaaa1111-0000-0000-0000-000000000000', payload: { sprint_dir: 'sprints/test' } },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/mock-wt/task-aaaa1111',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockSpawn,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
      existsSync: vi.fn().mockReturnValue(false),
      fsCp: vi.fn().mockResolvedValue(undefined),
    });

    expect(mockSpawn).toHaveBeenCalledOnce();
    const spawnCall = mockSpawn.mock.calls[0][0];
    expect(spawnCall.worktreePath).toBe('/mock-wt/task-aaaa1111');
  });

  it('cross-repo sprint: executor called with sub-task worktree when it exists', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({ exit_code: 0, timed_out: false, stderr: '' });
    const mockCp = vi.fn().mockResolvedValue(undefined);

    const state = {
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: {
        id: 'fc0dcc8d-6586-4026-9104-bfeba6f8d976',
        payload: {
          sprint_dir: 'sprints/zj1-smart-acquisition',
          base_repo: '/Users/admin/perfect21/zenithjoy',
        },
      },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/mock-wt/task-fc0dcc8d',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockSpawn,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
      existsSync: vi.fn().mockReturnValue(true),
      fsCp: mockCp,
    });

    expect(mockSpawn).toHaveBeenCalledOnce();
    const spawnCall = mockSpawn.mock.calls[0][0];
    // Should use sub-task worktree, not initiative worktree
    expect(spawnCall.worktreePath).toBe('/mock-wt/task-fc0dcc8d-ws1');
    // Sprint files should have been copied
    expect(mockCp).toHaveBeenCalledOnce();
    const cpCall = mockCp.mock.calls[0];
    expect(cpCall[0]).toBe('/mock-wt/task-fc0dcc8d/sprints/zj1-smart-acquisition');
    expect(cpCall[1]).toBe('/mock-wt/task-fc0dcc8d-ws1/sprints/zj1-smart-acquisition');
  });

  it('cross-repo sprint: fallback to initiative worktree when sub-task worktree missing', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({ exit_code: 0, timed_out: false, stderr: '' });

    const state = {
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: {
        id: 'fc0dcc8d-6586-4026-9104-bfeba6f8d976',
        payload: {
          sprint_dir: 'sprints/zj1-smart-acquisition',
          base_repo: '/Users/admin/perfect21/zenithjoy',
        },
      },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/mock-wt/task-fc0dcc8d',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockSpawn,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
      existsSync: vi.fn().mockReturnValue(false), // sub-task worktree doesn't exist
      fsCp: vi.fn(),
    });

    expect(mockSpawn).toHaveBeenCalledOnce();
    const spawnCall = mockSpawn.mock.calls[0][0];
    // Falls back to initiative worktree
    expect(spawnCall.worktreePath).toBe('/mock-wt/task-fc0dcc8d');
  });

  it('cross-repo sprint: readBrainResult reads from sub-task worktree', async () => {
    const mockSpawn = vi.fn().mockResolvedValue({ exit_code: 0, timed_out: false, stderr: '' });

    const state = {
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: {
        id: 'fc0dcc8d-6586-4026-9104-bfeba6f8d976',
        payload: {
          sprint_dir: 'sprints/zj1-smart-acquisition',
          base_repo: '/Users/admin/perfect21/zenithjoy',
        },
      },
      taskPlan: { journey_type: 'autonomous' },
      worktreePath: '/mock-wt/task-fc0dcc8d',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockSpawn,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
      existsSync: vi.fn().mockReturnValue(true),
      fsCp: vi.fn().mockResolvedValue(undefined),
    });

    // readBrainResult should be called with sub-task worktree path
    expect(readBrainResult).toHaveBeenCalledWith('/mock-wt/task-fc0dcc8d-ws1', ['verdict']);
  });
});
