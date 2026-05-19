import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => {
  const m = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() };
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
  readBrainResult: vi.fn(async () => ({})),
}));
vi.mock('../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
vi.mock('../harness-session-bridge.js', () => ({
  reconnectOrSpawn: vi.fn(),
  makeSessionRecord: vi.fn(() => ({})),
}));

const mockEnsureHarnessWorktree = vi.fn(async () => '/mock-wt/task-abc');
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...args) => mockEnsureHarnessWorktree(...args),
  harnessSubTaskBranchName: vi.fn(() => 'cp-0519-ws-abc-ws1'),
  harnessTaskWorktreePath: vi.fn((id) => `/mock-wt/task-${id}`),
  DEFAULT_BASE_REPO: '/mock-cecelia',
}));

vi.mock('@langchain/langgraph', () => {
  const Annotation = vi.fn((opts) => opts);
  Annotation.Root = vi.fn((fields) => fields);
  return {
    StateGraph: vi.fn(() => ({
      addNode: vi.fn(),
      addEdge: vi.fn(),
      addConditionalEdges: vi.fn(),
      compile: vi.fn(() => ({ invoke: vi.fn() })),
    })),
    Annotation,
    START: '__start__',
    END: '__end__',
    interrupt: vi.fn(),
  };
});

import { spawnNode } from '../workflows/harness-task.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('spawnNode — baseRepo 透传到 ensureHarnessWorktree', () => {
  it('state.baseRepo 传入时，ensureHarnessWorktree 收到 baseRepo', async () => {
    const state = {
      task: { id: 'ws1', title: 'test task', payload: {} },
      initiativeId: 'abcdef12-0000-0000-0000-000000000000',
      worktreePath: null,
      githubToken: null,
      baseRepo: '/Users/admin/perfect21/zenithjoy',
      contractBranch: null,
      containerId: null,
    };

    await spawnNode(state, {
      spawnDetached: vi.fn(async () => 'container-id-123'),
      ensureWorktree: mockEnsureHarnessWorktree,
      resolveToken: vi.fn(async () => 'ghp_tok'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    });

    expect(mockEnsureHarnessWorktree).toHaveBeenCalledOnce();
    const callArgs = mockEnsureHarnessWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBe('/Users/admin/perfect21/zenithjoy');
  });

  it('state.baseRepo 为 null 时，ensureHarnessWorktree 收到 undefined（用默认 cecelia）', async () => {
    const state = {
      task: { id: 'ws1', title: 'test task', payload: {} },
      initiativeId: 'abcdef12-0000-0000-0000-000000000000',
      worktreePath: null,
      githubToken: null,
      baseRepo: null,
      contractBranch: null,
      containerId: null,
    };

    await spawnNode(state, {
      spawnDetached: vi.fn(async () => 'container-id-123'),
      ensureWorktree: mockEnsureHarnessWorktree,
      resolveToken: vi.fn(async () => 'ghp_tok'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
    });

    expect(mockEnsureHarnessWorktree).toHaveBeenCalledOnce();
    const callArgs = mockEnsureHarnessWorktree.mock.calls[0][0];
    expect(callArgs.baseRepo).toBeUndefined();
  });
});
