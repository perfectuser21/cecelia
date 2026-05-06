/**
 * harness-initiative-evaluate.test.js
 *
 * TDD — RED phase: tests for serial evaluate loop changes in harness-initiative.graph.js
 *
 * Tests:
 * 1. parsePrdNode v8 leniency — on parseTaskPlan error, return null taskPlan (not error)
 * 2. inferTaskPlanNode from propose branch — reads task-plan.json via git show
 * 3. evaluateSubTaskNode PASS
 * 4. evaluateSubTaskNode FAIL
 * 5. routeAfterEvaluate — 4 cases
 * 6. pickSubTaskNode — returns correct sub_task
 * 7. advanceTaskIndexNode — increments task_loop_index
 * 8. retryTaskNode — increments task_loop_fix_count, keeps evaluate_feedback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all external dependencies (same pattern as harness-initiative-create-fix-task.test.js) ───

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
}));

vi.mock('../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn(),
}));

import { parseTaskPlan } from '../harness-dag.js';
import { parseDockerOutput } from '../harness-shared.js';

import {
  parsePrdNode,
  inferTaskPlanNode,
  evaluateSubTaskNode,
  routeAfterEvaluate,
  pickSubTaskNode,
  advanceTaskIndexNode,
  retryTaskNode,
} from '../workflows/harness-initiative.graph.js';

// ─── 1. parsePrdNode v8 leniency ─────────────────────────────────────────────

describe('parsePrdNode — Planner v8 leniency', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    parseDockerOutput.mockImplementation((x) => x);
  });

  it('when parseTaskPlan throws, returns { taskPlan: null } instead of { error: ... }', async () => {
    parseTaskPlan.mockImplementation(() => { throw new Error('no json block found'); });

    const state = {
      plannerOutput: 'some planner output without json block',
      worktreePath: '/tmp/wt',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-123',
    };

    const result = await parsePrdNode(state);

    // Must NOT have error field
    expect(result.error).toBeUndefined();
    // taskPlan must be null (not throwing)
    expect(result.taskPlan).toBeNull();
    // prdContent should be set (fallback to plannerOutput since fs read will fail)
    expect(result.prdContent).toBeDefined();
  });

  it('when parseTaskPlan succeeds, returns taskPlan normally', async () => {
    const mockPlan = { initiative_id: 'pending', tasks: [{ id: 't1', title: 'Task 1' }] };
    parseTaskPlan.mockReturnValue(mockPlan);

    const state = {
      plannerOutput: 'planner output text',
      worktreePath: '/tmp/wt',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-456',
    };

    const result = await parsePrdNode(state);

    expect(result.error).toBeUndefined();
    expect(result.taskPlan).toBeDefined();
    // initiative_id should be replaced with state.initiativeId since it was 'pending'
    expect(result.taskPlan.initiative_id).toBe('init-456');
  });

  it('short-circuits when state already has taskPlan and prdContent', async () => {
    const existingPlan = { tasks: [{ id: 't1' }] };
    const state = {
      taskPlan: existingPlan,
      prdContent: 'existing content',
    };

    const result = await parsePrdNode(state);

    expect(result.taskPlan).toBe(existingPlan);
    expect(result.prdContent).toBe('existing content');
    expect(parseTaskPlan).not.toHaveBeenCalled();
  });
});

// ─── 2. inferTaskPlanNode from propose branch ─────────────────────────────────

describe('inferTaskPlanNode — reads from propose branch via git show', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('skips (returns {}) when taskPlan.tasks already has items', async () => {
    const state = {
      taskPlan: { tasks: [{ id: 't1', title: 'Task 1' }] },
      ganResult: { propose_branch: 'feature/my-branch' },
      worktreePath: '/tmp/wt',
    };

    const result = await inferTaskPlanNode(state);
    expect(result).toEqual({});
  });

  it('returns {} gracefully when git show fails', async () => {
    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'feature/nonexistent-branch-xyz-999' },
      worktreePath: '/tmp/nonexistent-path-xyz',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-999',
    };

    // This will fail because the worktree does not exist and branch does not exist
    const result = await inferTaskPlanNode(state);

    // Should gracefully return {} instead of throwing
    expect(result).toEqual({});
  });

  it('returns {} when no propose_branch in ganResult', async () => {
    const state = {
      taskPlan: null,
      ganResult: {},
      worktreePath: '/tmp/wt',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-000',
    };

    const result = await inferTaskPlanNode(state);
    expect(result).toEqual({});
  });

  it('returns {} when ganResult is null', async () => {
    const state = {
      taskPlan: null,
      ganResult: null,
      worktreePath: '/tmp/wt',
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'init-000',
    };

    const result = await inferTaskPlanNode(state);
    expect(result).toEqual({});
  });
});

// ─── 3 & 4. evaluateSubTaskNode ───────────────────────────────────────────────

describe('evaluateSubTaskNode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    parseDockerOutput.mockImplementation((x) => x);
  });

  it('PASS: returns evaluate_verdict=PASS when executor outputs JSON with verdict=PASS', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      exit_code: 0,
      timed_out: false,
      stdout: 'Some log line\n{"verdict": "PASS", "all_dod": "passed", "checked": 2}',
      stderr: '',
    });

    const state = {
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous', tasks: [{ id: 'sub-1', title: 'Sub Task 1' }] },
      task_loop_index: 0,
      worktreePath: '/tmp/wt',
      githubToken: 'gh-token',
    };

    const result = await evaluateSubTaskNode(state, { executor: mockExecutor });

    expect(result.evaluate_verdict).toBe('PASS');
    expect(result.evaluate_feedback).toBeNull();
    expect(mockExecutor).toHaveBeenCalledOnce();
  });

  it('FAIL: returns evaluate_verdict=FAIL with feedback when executor outputs verdict=FAIL', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      exit_code: 0,
      timed_out: false,
      stdout: '{"verdict": "FAIL", "feedback": "specific error in test suite"}',
      stderr: '',
    });

    const state = {
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous', tasks: [] },
      task_loop_index: 0,
      worktreePath: '/tmp/wt',
      githubToken: 'gh-token',
    };

    const result = await evaluateSubTaskNode(state, { executor: mockExecutor });

    expect(result.evaluate_verdict).toBe('FAIL');
    expect(result.evaluate_feedback).toBe('specific error in test suite');
  });

  it('FAIL: returns FAIL when executor exits with non-zero', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      exit_code: 1,
      timed_out: false,
      stdout: '',
      stderr: 'docker failed',
    });

    const state = {
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous', tasks: [] },
      task_loop_index: 0,
      worktreePath: '/tmp/wt',
      githubToken: 'gh-token',
    };

    const result = await evaluateSubTaskNode(state, { executor: mockExecutor });

    expect(result.evaluate_verdict).toBe('FAIL');
    expect(result.evaluate_feedback).toBeDefined();
  });

  it('FAIL: returns FAIL when executor output missing verdict field', async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      exit_code: 0,
      timed_out: false,
      stdout: '{"some": "output without verdict field"}',
      stderr: '',
    });

    const state = {
      task: { id: 'task-1', payload: { sprint_dir: 'sprints' } },
      taskPlan: { journey_type: 'autonomous', tasks: [] },
      task_loop_index: 0,
      worktreePath: '/tmp/wt',
      githubToken: 'gh-token',
    };

    const result = await evaluateSubTaskNode(state, { executor: mockExecutor });

    expect(result.evaluate_verdict).toBe('FAIL');
  });
});

// ─── 5. routeAfterEvaluate — 4 cases ─────────────────────────────────────────

describe('routeAfterEvaluate', () => {
  it('PASS + more tasks → advance', () => {
    const state = {
      evaluate_verdict: 'PASS',
      task_loop_index: 0,
      task_loop_fix_count: 0,
      taskPlan: { tasks: [{ id: 't1' }, { id: 't2' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('advance');
  });

  it('PASS + last task → final_evaluate', () => {
    const state = {
      evaluate_verdict: 'PASS',
      task_loop_index: 1,
      task_loop_fix_count: 0,
      taskPlan: { tasks: [{ id: 't1' }, { id: 't2' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('final_evaluate');
  });

  it('FAIL + count < 3 → retry', () => {
    const state = {
      evaluate_verdict: 'FAIL',
      task_loop_index: 0,
      task_loop_fix_count: 1,
      taskPlan: { tasks: [{ id: 't1' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('retry');
  });

  it('FAIL + count >= 3 → terminal_fail', () => {
    const state = {
      evaluate_verdict: 'FAIL',
      task_loop_index: 0,
      task_loop_fix_count: 3,
      taskPlan: { tasks: [{ id: 't1' }] },
    };
    expect(routeAfterEvaluate(state)).toBe('terminal_fail');
  });

  it('with error → end', () => {
    const state = {
      error: { node: 'some_node', message: 'oops' },
      evaluate_verdict: 'PASS',
      task_loop_index: 0,
      task_loop_fix_count: 0,
      taskPlan: { tasks: [] },
    };
    expect(routeAfterEvaluate(state)).toBe('end');
  });
});

// ─── 6. pickSubTaskNode ────────────────────────────────────────────────────────

describe('pickSubTaskNode', () => {
  it('returns correct sub_task at task_loop_index=0', async () => {
    const state = {
      taskPlan: {
        tasks: [
          { id: 'task-1', title: 'First Task', scope: 'Do thing 1', dod: 'done', files: [] },
          { id: 'task-2', title: 'Second Task', scope: 'Do thing 2', dod: 'done', files: [] },
        ],
      },
      task_loop_index: 0,
    };

    const result = await pickSubTaskNode(state);

    expect(result.sub_task).toBeDefined();
    expect(result.sub_task.id).toBe('task-1');
    expect(result.sub_task.title).toBe('First Task');
    expect(result.task_loop_fix_count).toBe(0);
    expect(result.evaluate_verdict).toBeNull();
    expect(result.evaluate_feedback).toBeNull();
  });

  it('returns correct sub_task at task_loop_index=1', async () => {
    const state = {
      taskPlan: {
        tasks: [
          { id: 'task-1', title: 'First Task', scope: 'Do thing 1' },
          { id: 'task-2', title: 'Second Task', scope: 'Do thing 2' },
        ],
      },
      task_loop_index: 1,
    };

    const result = await pickSubTaskNode(state);

    expect(result.sub_task.id).toBe('task-2');
    expect(result.sub_task.title).toBe('Second Task');
  });

  it('returns null sub_task when index >= tasks.length', async () => {
    const state = {
      taskPlan: { tasks: [{ id: 'task-1', title: 'Only Task' }] },
      task_loop_index: 1,
    };

    const result = await pickSubTaskNode(state);

    expect(result.sub_task).toBeNull();
  });

  it('resets task_loop_fix_count to 0 on each pick', async () => {
    const state = {
      taskPlan: { tasks: [{ id: 'task-1', title: 'Task', scope: 'scope' }] },
      task_loop_index: 0,
      task_loop_fix_count: 5,
    };

    const result = await pickSubTaskNode(state);

    expect(result.task_loop_fix_count).toBe(0);
  });
});

// ─── 7. advanceTaskIndexNode ─────────────────────────────────────────────────

describe('advanceTaskIndexNode', () => {
  it('increments task_loop_index by 1', async () => {
    const state = { task_loop_index: 0, task_loop_fix_count: 2 };
    const result = await advanceTaskIndexNode(state);
    expect(result.task_loop_index).toBe(1);
  });

  it('resets task_loop_fix_count to 0', async () => {
    const state = { task_loop_index: 2, task_loop_fix_count: 3 };
    const result = await advanceTaskIndexNode(state);
    expect(result.task_loop_fix_count).toBe(0);
  });

  it('clears evaluate_verdict and evaluate_feedback', async () => {
    const state = { task_loop_index: 1, task_loop_fix_count: 1, evaluate_verdict: 'PASS', evaluate_feedback: 'some feedback' };
    const result = await advanceTaskIndexNode(state);
    expect(result.evaluate_verdict).toBeNull();
    expect(result.evaluate_feedback).toBeNull();
  });
});

// ─── 8. retryTaskNode ────────────────────────────────────────────────────────

describe('retryTaskNode', () => {
  it('increments task_loop_fix_count', async () => {
    const state = { task_loop_fix_count: 1, evaluate_feedback: 'error details' };
    const result = await retryTaskNode(state);
    expect(result.task_loop_fix_count).toBe(2);
  });

  it('keeps evaluate_feedback for use by run_sub_task (does not clear it)', async () => {
    const state = { task_loop_fix_count: 0, evaluate_feedback: 'specific failure reason' };
    const result = await retryTaskNode(state);
    // evaluate_feedback should NOT be cleared (run_sub_task uses it as fix context)
    // result.evaluate_feedback can be undefined (not set) but should NOT be null
    expect(result.evaluate_feedback).not.toBe(null);
  });

  it('resets evaluate_verdict to null', async () => {
    const state = { task_loop_fix_count: 1, evaluate_verdict: 'FAIL', evaluate_feedback: 'err' };
    const result = await retryTaskNode(state);
    expect(result.evaluate_verdict).toBeNull();
  });
});
