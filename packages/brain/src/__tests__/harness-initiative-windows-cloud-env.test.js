/**
 * harness-initiative-windows-cloud-env.test.js
 *
 * 集成测试：验证 finalEvaluateDispatchNode 正确注入 TARGET_ENV 和 GITHUB_REPO
 * 对应断链修复：
 *   断链 #1/#2: base_repo → GITHUB_REPO 映射 + target_environment → TARGET_ENV 注入
 *   断链 #4: powershell 提取逻辑（harness-evaluator/SKILL.md，无法在 JS 单测验证，用 bash 测）
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

import { finalEvaluateDispatchNode } from '../workflows/harness-initiative.graph.js';
import { readBrainResult } from '../harness-shared.js';

// ─── 断链 #2: TARGET_ENV 注入 ─────────────────────────────────────────────────

describe('finalEvaluateDispatchNode — TARGET_ENV 注入（断链 #2）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readBrainResult).mockResolvedValue({ verdict: 'PASS' });
  });

  it('从 prdContent 提取 windows_cloud 并注入 TARGET_ENV', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-z1', payload: { sprint_dir: 'sprints/run-001', base_repo: 'zenithjoy' } },
      taskPlan: { journey_type: 'user_facing' },
      prdContent: `# Sprint PRD\n\n## journey_type: user_facing\n## target_environment: windows_cloud\n`,
      worktreePath: '/tmp/wt-zenithjoy',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.TARGET_ENV).toBe('windows_cloud');
  });

  it('从 prdContent 提取 local_api 并注入 TARGET_ENV', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-c1', payload: { sprint_dir: 'sprints/run-002' } },
      taskPlan: { journey_type: 'autonomous' },
      prdContent: `# Sprint PRD\n\n## journey_type: autonomous\n## target_environment: local_api\n`,
      worktreePath: '/tmp/wt-cecelia',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.TARGET_ENV).toBe('local_api');
  });

  it('prdContent 缺失时 TARGET_ENV 默认 local_api', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-c2', payload: { sprint_dir: 'sprints/run-003' } },
      taskPlan: { journey_type: 'autonomous' },
      prdContent: null,
      worktreePath: '/tmp/wt-cecelia',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.TARGET_ENV).toBe('local_api');
  });
});

// ─── 断链 #1: GITHUB_REPO 注入（base_repo → repo 映射） ───────────────────────

describe('finalEvaluateDispatchNode — GITHUB_REPO 注入（断链 #1）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readBrainResult).mockResolvedValue({ verdict: 'PASS' });
  });

  it('base_repo=zenithjoy → GITHUB_REPO=perfectuser21/zenithjoy-workspace', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-z2', payload: { sprint_dir: 'sprints/run-004', base_repo: 'zenithjoy' } },
      taskPlan: { journey_type: 'user_facing' },
      prdContent: '## target_environment: windows_cloud',
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.GITHUB_REPO).toBe('perfectuser21/zenithjoy-workspace');
  });

  it('base_repo=zenithjoy-workspace → GITHUB_REPO=perfectuser21/zenithjoy-workspace', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-z3', payload: { sprint_dir: 'sprints/run-005', base_repo: 'zenithjoy-workspace' } },
      taskPlan: { journey_type: 'user_facing' },
      prdContent: '## target_environment: windows_cloud',
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.GITHUB_REPO).toBe('perfectuser21/zenithjoy-workspace');
  });

  it('base_repo 缺失 → GITHUB_REPO=perfectuser21/cecelia（默认）', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-c3', payload: { sprint_dir: 'sprints/run-006' } },
      taskPlan: { journey_type: 'autonomous' },
      prdContent: '## target_environment: local_api',
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.GITHUB_REPO).toBe('perfectuser21/cecelia');
  });

  it('base_repo=cecelia → GITHUB_REPO=perfectuser21/cecelia', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-c4', payload: { sprint_dir: 'sprints/run-007', base_repo: 'cecelia' } },
      taskPlan: { journey_type: 'autonomous' },
      prdContent: '## target_environment: local_api',
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'tok',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.GITHUB_REPO).toBe('perfectuser21/cecelia');
  });

  it('executor env 包含所有必须字段（TARGET_ENV + GITHUB_REPO 同时注入）', async () => {
    const capturedEnv = {};
    const mockExecutor = vi.fn().mockImplementation(async (opts) => {
      Object.assign(capturedEnv, opts.env || {});
      return { exit_code: 0, timed_out: false, stderr: '' };
    });

    const state = {
      final_e2e_verdict: null,
      final_e2e_fix_count: 0,
      task_loop_index: 0,
      task: { id: 'task-z4', payload: { sprint_dir: 'sprints/run-008', base_repo: 'zenithjoy' } },
      taskPlan: { journey_type: 'user_facing' },
      prdContent: '## target_environment: windows_cloud',
      worktreePath: '/tmp/wt',
      sub_tasks: [],
      githubToken: 'ghtoken',
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: vi.fn().mockResolvedValue({ stdout: '' }),
    });

    expect(capturedEnv.TARGET_ENV).toBe('windows_cloud');
    expect(capturedEnv.GITHUB_REPO).toBe('perfectuser21/zenithjoy-workspace');
    expect(capturedEnv.JOURNEY_TYPE).toBe('user_facing');
    expect(capturedEnv.SPRINT_DIR).toBe('sprints/run-008');
    expect(capturedEnv.IS_FINAL_E2E).toBe('true');
    expect(capturedEnv.GITHUB_TOKEN).toBe('ghtoken');
  });
});
