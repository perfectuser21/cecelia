import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: vi.fn().mockReturnValue(null),
  upsertTaskPlan: vi.fn(),
}));
vi.mock('../../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null), put: vi.fn(), setup: vi.fn(),
    list: vi.fn().mockResolvedValue([]), getTuple: vi.fn().mockResolvedValue(null), putWrites: vi.fn(),
  }),
}));

import { runSubTaskNode } from '../harness-initiative.graph.js';

describe('runSubTaskNode — B38: 正确 sprintDir 注入到子任务 payload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('state.sprintDir 覆盖 subTask.payload.sprint_dir（B37 修正值传递给 generator）', async () => {
    const capturedTask = {};
    const mockCompiledGraph = {
      invoke: vi.fn().mockImplementation(async ({ task }) => {
        Object.assign(capturedTask, task);
        return { status: 'merged', pr_url: 'https://github.com/test/pr/1' };
      }),
      getState: vi.fn().mockResolvedValue({ values: { status: 'merged' } }),
    };

    const state = {
      sub_task: {
        id: 'sub-uuid-ws1',
        title: '创建验证脚本',
        description: 'ws1 任务',
        payload: {
          sprint_dir: 'sprints',  // 原始未修正值
          contract_branch: 'cp-propose-r4',
          logical_task_id: 'ws1',
        },
      },
      sprintDir: 'sprints/w49-b37-validation',  // B37 修正后的值
      initiativeId: 'init-test-123',
      githubToken: 'test-token',
      contractBranch: 'cp-propose-r4',
      task_loop_fix_count: 0,
      evaluate_feedback: null,
    };

    await runSubTaskNode(state, {
      compiledTaskGraph: mockCompiledGraph,
      waitMs: 0,
    });

    // B38: generator 收到的 task.payload.sprint_dir 必须是修正后的值
    expect(capturedTask.payload.sprint_dir).toBe('sprints/w49-b37-validation');
    expect(mockCompiledGraph.invoke).toHaveBeenCalledOnce();
  });

  it('state.sprintDir 为空时保持 subTask.payload.sprint_dir 原值', async () => {
    const capturedTask = {};
    const mockCompiledGraph = {
      invoke: vi.fn().mockImplementation(async ({ task }) => {
        Object.assign(capturedTask, task);
        return { status: 'merged', pr_url: 'https://github.com/test/pr/2' };
      }),
    };

    const state = {
      sub_task: {
        id: 'sub-uuid-ws2',
        title: '任务2',
        description: '',
        payload: {
          sprint_dir: 'sprints/w50-fallback',  // 已有正确值
        },
      },
      sprintDir: null,  // B37 未运行或未修正
      initiativeId: 'init-test-456',
      githubToken: 'token',
      task_loop_fix_count: 0,
      evaluate_feedback: null,
    };

    await runSubTaskNode(state, {
      compiledTaskGraph: mockCompiledGraph,
      waitMs: 0,
    });

    // sprintDir 为空时，不覆盖原有的 sprint_dir
    expect(capturedTask.payload.sprint_dir).toBe('sprints/w50-fallback');
  });

  it('logical_task_id 仍然被注入（B38 不影响已有行为）', async () => {
    const capturedTask = {};
    const mockCompiledGraph = {
      invoke: vi.fn().mockImplementation(async ({ task }) => {
        Object.assign(capturedTask, task);
        return { status: 'merged' };
      }),
    };

    const state = {
      sub_task: {
        id: 'sub-uuid-ws3',
        title: '任务3',
        description: '',
        payload: { sprint_dir: 'sprints' },
      },
      sprintDir: 'sprints/w49-test',
      initiativeId: 'init-test-789',
      githubToken: 'token',
      task_loop_fix_count: 0,
      evaluate_feedback: null,
    };

    await runSubTaskNode(state, {
      compiledTaskGraph: mockCompiledGraph,
      waitMs: 0,
    });

    expect(capturedTask.payload.logical_task_id).toBe('sub-uuid-ws3');
    expect(capturedTask.payload.sprint_dir).toBe('sprints/w49-test');
  });
});
