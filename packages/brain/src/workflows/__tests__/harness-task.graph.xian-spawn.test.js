import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => {
  const m = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() };
  return { default: m, ...m };
});
vi.mock('../../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(),
  verifyGeneratorOutput: vi.fn(),
  verifyEvaluatorWorktree: vi.fn(),
}));
vi.mock('../../harness-dag.js', () => ({ parseTaskPlan: vi.fn(() => null), upsertTaskPlan: vi.fn() }));
vi.mock('../../harness-final-e2e.js', () => ({ runFinalE2E: vi.fn(), attributeFailures: vi.fn() }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn(async () => 'tok') }));
vi.mock('../../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: vi.fn(),
  loadSkillContent: vi.fn(() => ''),
  readBrainResult: vi.fn(async () => ({})),
}));
vi.mock('../../harness-pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
vi.mock('../../harness-session-bridge.js', () => ({
  reconnectOrSpawn: vi.fn(),
  makeSessionRecord: vi.fn(() => ({})),
}));

const mockEnsureHarnessWorktree = vi.fn(async () => '/mock-wt/task-abc');
vi.mock('../../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...args) => mockEnsureHarnessWorktree(...args),
  harnessSubTaskBranchName: vi.fn(() => 'cp-0604-ws-abc-ws1'),
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

import { spawnNode } from '../harness-task.graph.js';

// codex 路由：resolveExecutor 返回西安
const codexRoute = vi.fn(async () => ({
  executor: 'codex',
  url: 'http://100.86.57.69:3458',
  machineId: 'mac-mini-m4-xian',
}));

function baseState(overrides = {}) {
  return {
    task: {
      id: 'ws1',
      title: 'Test',
      description: 'Desc',
      payload: {
        machine: 'mac-mini-m4-xian',
        executor: 'codex',
        base_repo: 'https://github.com/perfectuser21/infrastructure.git',
      },
    },
    initiativeId: 'abcdef12-0000-0000-0000-000000000000',
    worktreePath: '/mock-wt/task-ws1',
    githubToken: 'ghp_test_token',
    baseRepo: 'https://github.com/perfectuser21/infrastructure.git',
    contractBranch: 'cp-harness-propose-r3-abc',
    contractImported: true,
    containerId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('harness-task.graph — spawnNode codex 路径 push contract + GITHUB_TOKEN', () => {
  it('codex push 前先 commit（兜底 import commit 偶发未落地 → 合同 staged 未提交 → push 漏合同）', async () => {
    // 实证 60fa150f：import 的 commit 偶发没落地（合同 staged 但未 committed），push 只传 committed
    // → 西安 codex clone 的分支没合同 → 无产出无 PR。修：push 前 add -A + commit 兜底。
    const seq = [];
    const mockExecFile = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && Array.isArray(args)) {
        // 兜底提交的签名：git add -A（import 用的是 add sprints/，以此区分）
        if (args.includes('add') && args.includes('-A')) seq.push('add-A');
        if (args.includes('push')) seq.push('push');
      }
      return { stdout: '', stderr: '' };
    });

    await spawnNode(baseState({ contractBranch: 'cp-harness-propose-r3-abc', contractImported: false }), {
      spawnBridge: vi.fn(async () => {}),
      execFile: mockExecFile,
      resolveExecutor: codexRoute,
      resolveToken: vi.fn(async () => 'ghp_test_token'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
    });

    // push 之前必须有 add -A 兜底提交（确保 import 偶发未落地的 staged 合同被提交进 HEAD）
    const pushIdx = seq.lastIndexOf('push');
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(seq.slice(0, pushIdx)).toContain('add-A');
  });

  it('codex 路径：spawnBridgeFn 之前 push contract 到 GitHub', async () => {
    const order = [];
    const mockExecFile = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args.includes('push')) {
        order.push('push');
      }
      return { stdout: '', stderr: '' };
    });
    const mockSpawnBridge = vi.fn(async () => { order.push('bridge'); });

    await spawnNode(baseState(), {
      spawnBridge: mockSpawnBridge,
      execFile: mockExecFile,
      resolveExecutor: codexRoute,
      resolveToken: vi.fn(async () => 'ghp_test_token'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
    });

    expect(mockSpawnBridge).toHaveBeenCalledOnce();
    expect(order).toEqual(['push', 'bridge']); // push 必须在 bridge 之前
  });

  it('codex payload 包含 env.GITHUB_TOKEN', async () => {
    const bridgeCalls = [];
    const mockSpawnBridge = vi.fn(async (url, payload) => { bridgeCalls.push(payload); });

    await spawnNode(baseState(), {
      spawnBridge: mockSpawnBridge,
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
      resolveExecutor: codexRoute,
      resolveToken: vi.fn(async () => 'ghp_test_token'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
    });

    expect(bridgeCalls).toHaveLength(1);
    expect(bridgeCalls[0].env?.GITHUB_TOKEN).toBe('ghp_test_token');
    expect(bridgeCalls[0].mode).toBe('codex');
    expect(bridgeCalls[0].repo).toBe('https://github.com/perfectuser21/infrastructure.git');
  });

  it('首次运行：contractBranch 有 + state.contractImported=false → 本次导入合同后仍须 push（修西安codex无合同bug）', async () => {
    // 根因：合同在 line 198 本次刚导入进 worktree，但 push 门控读 state.contractImported——
    // 它只在函数 return 时才置 true，同一次执行里仍是 false → push 被跳过 → generator 分支没合同上
    // GitHub → 西安 codex clone 后没合同可读 → 啥也不产出 → AHEAD=0 → 无 PR（实证 358c80f3）。
    const pushCalls = [];
    const mockExecFile2 = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args.includes('push')) pushCalls.push(args);
      return { stdout: '', stderr: '' };
    });

    await spawnNode(
      baseState({ contractBranch: 'cp-harness-propose-r3-abc', contractImported: false }),
      {
        spawnBridge: vi.fn(async () => {}),
        execFile: mockExecFile2,
        resolveExecutor: codexRoute,
        resolveToken: vi.fn(async () => 'ghp_test_token'),
        poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
      }
    );

    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('contractImported=false 且无 contractBranch 时不 push（无合同导入无需 push）', async () => {
    const pushCalls = [];
    const mockExecFile = vi.fn(async (cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args.includes('push')) pushCalls.push(args);
      return { stdout: '', stderr: '' };
    });

    await spawnNode(baseState({ contractBranch: null, contractImported: false }), {
      spawnBridge: vi.fn(async () => {}),
      execFile: mockExecFile,
      resolveExecutor: codexRoute,
      resolveToken: vi.fn(async () => 'ghp_test_token'),
      poolOverride: { query: vi.fn(async () => ({ rows: [] })) },
    });

    expect(pushCalls).toHaveLength(0);
  });
});
