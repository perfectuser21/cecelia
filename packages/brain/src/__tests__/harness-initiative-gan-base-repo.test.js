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
const mockReadBrainResult = vi.fn(async () => ({ propose_branch: 'cp-harness-propose-r1-abcdef12' }));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn(),
  loadSkillContent: vi.fn(() => ''),
  readBrainResult: (...args) => mockReadBrainResult(...args),
}));
vi.mock('../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
const mockReconnectOrSpawn = vi.fn(async () => ({
  exit_code: 0,
  contractContent: '# Contract Draft\nsome content',
  propose_branch: 'cp-harness-propose-r1-abcdef12',
  cost_usd: 0,
}));
vi.mock('../harness-session-bridge.js', () => ({
  reconnectOrSpawn: (...args) => mockReconnectOrSpawn(...args),
  makeSessionRecord: vi.fn(() => ({})),
}));
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/mock-wt/task-abc'),
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
  };
});
vi.mock('./retry-policies.js', () => ({ LLM_RETRY: {}, DB_RETRY: {}, NO_RETRY: {} }));

import { createGanContractNodes } from '../workflows/harness-gan.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe.skip('createGanContractNodes — baseRepo 透传到 verifyProposer [WS3 async: interrupt() 先于 verifyProposer 执行，需迁移]', () => {
  it('ctx 传入 baseRepo 时，verifyProposer 被调用时能收到 baseRepo', async () => {
    const capturedVerifyArgs = [];
    const mockVerifyProposer = vi.fn(async (opts) => {
      capturedVerifyArgs.push(opts);
    });

    // 模拟 executor 返回 PROPOSED verdict
    const executor = vi.fn(async () => ({
      exit_code: 0,
      stdout: JSON.stringify({ verdict: 'PROPOSED', contract_draft_path: 'sprints/test/contract-draft.md' }),
      timed_out: false,
    }));

    const ctx = {
      taskId: 'abcdef1234567890',
      initiativeId: 'init-abc',
      sprintDir: 'sprints/test',
      worktreePath: '/mock-wt',
      githubToken: 'tok',
      baseRepo: '/Users/admin/perfect21/zenithjoy',
      verifyProposer: mockVerifyProposer,
      readContractFile: vi.fn(async () => '# Contract Draft\nsome content'),
    };

    const nodes = createGanContractNodes(executor, ctx);
    expect(typeof nodes.proposer).toBe('function');

    // 调用 proposer 节点
    const result = await nodes.proposer({ round: 0 }).catch(e => ({ _error: e.message }));

    // 验证 verifyProposer 被调用且收到了 baseRepo
    expect(mockVerifyProposer).toHaveBeenCalledOnce();
    const callOpts = mockVerifyProposer.mock.calls[0][0];
    expect(callOpts.baseRepo).toBe('/Users/admin/perfect21/zenithjoy');
  });

  it('ctx 未传 baseRepo 时，verifyProposer 收到 undefined（fallback 由 contract-verify 处理）', async () => {
    const capturedVerifyArgs = [];
    const mockVerifyProposer = vi.fn(async (opts) => {
      capturedVerifyArgs.push(opts);
    });

    const executor = vi.fn(async () => ({
      exit_code: 0,
      stdout: JSON.stringify({ verdict: 'PROPOSED', contract_draft_path: 'sprints/test/contract-draft.md' }),
      timed_out: false,
    }));

    const ctx = {
      taskId: 'abcdef1234567890',
      initiativeId: 'init-no-base',
      sprintDir: 'sprints/test',
      worktreePath: '/mock-wt',
      githubToken: 'tok',
      // no baseRepo
      verifyProposer: mockVerifyProposer,
      readContractFile: vi.fn(async () => '# Contract Draft'),
    };

    const nodes = createGanContractNodes(executor, ctx);
    await nodes.proposer({ round: 0 }).catch(() => {});

    expect(mockVerifyProposer).toHaveBeenCalledOnce();
    const callOpts = mockVerifyProposer.mock.calls[0][0];
    expect(callOpts.baseRepo).toBeUndefined();
  });
});
