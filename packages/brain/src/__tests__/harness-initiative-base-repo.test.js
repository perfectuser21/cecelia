import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 必须在任何 import graph 之前声明 mock ──
vi.mock('node:fs/promises', () => {
  const m = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn() };
  return { default: m, ...m };
});
vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(),
  verifyGeneratorOutput: vi.fn(),
  verifyEvaluatorWorktree: vi.fn(),
}));
vi.mock('../harness-dag.js', () => ({ parseTaskPlan: vi.fn(() => null), upsertTaskPlan: vi.fn() }));
vi.mock('../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn(async () => 'tok') }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn(),
  loadSkillContent: vi.fn(() => ''),
  readBrainResult: vi.fn(),
}));
vi.mock('../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
vi.mock('../harness-session-bridge.js', () => ({
  reconnectOrSpawn: vi.fn(),
  makeSessionRecord: vi.fn(),
}));
vi.mock('../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('@langchain/langgraph', () => {
  const Annotation = vi.fn((opts) => opts);
  Annotation.Root = vi.fn((fields) => fields);
  return {
    StateGraph: vi.fn(() => ({ addNode: vi.fn(), addEdge: vi.fn(), compile: vi.fn(() => ({ invoke: vi.fn() })) })),
    Annotation,
    START: '__start__',
    END: '__end__',
  };
});
vi.mock('../orchestrator/pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
vi.mock('./retry-policies.js', () => ({ LLM_RETRY: {}, DB_RETRY: {}, NO_RETRY: {} }));

const mockEnsureWorktree = vi.fn(async () => '/mock-wt/task-abc');
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...args) => mockEnsureWorktree(...args),
  harnessTaskWorktreePath: vi.fn((id) => `/mock-wt/task-${id}`),
  DEFAULT_BASE_REPO: '/mock-cecelia',
}));

import { prepInitiativeNode } from '../workflows/harness-initiative.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureWorktree.mockResolvedValue('/mock-wt/task-abc');
});

describe('prepInitiativeNode — base_repo 透传', () => {
  it('当 payload 有 base_repo 时，透传给 ensureHarnessWorktree', async () => {
    const state = {
      task: {
        id: 'task-id-abc123',
        payload: { base_repo: '/Users/admin/perfect21/zenithjoy' },
      },
    };

    await prepInitiativeNode(state);

    expect(mockEnsureWorktree).toHaveBeenCalledOnce();
    const callArgs = mockEnsureWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBe('/Users/admin/perfect21/zenithjoy');
    expect(callArgs.taskId).toBe('task-id-abc123');
  });

  it('当 payload 没有 base_repo 时，不传 baseRepo（让 worktree fallback DEFAULT）', async () => {
    const state = {
      task: {
        id: 'task-no-base',
        payload: { sprint_dir: 'sprints' },
      },
    };

    await prepInitiativeNode(state);

    const callArgs = mockEnsureWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBeUndefined();
  });

  it('已有 worktreePath 时，跳过调用（幂等）', async () => {
    const state = {
      worktreePath: '/existing/wt',
      task: { id: 'x', payload: { base_repo: '/some/repo' } },
    };

    const result = await prepInitiativeNode(state);

    expect(mockEnsureWorktree).not.toHaveBeenCalled();
    expect(result.worktreePath).toBe('/existing/wt');
  });
});
