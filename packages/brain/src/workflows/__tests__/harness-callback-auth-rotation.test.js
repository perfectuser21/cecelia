/**
 * 根因 2 回归测试 — harness generator 容器 401 auth 失败必须触发账号轮换。
 *
 * 实证：generator 容器内 claude CLI 401（OAuth token 过期/revoked）→ exit≠0 →
 * awaitCallbackNode 只标 ci_fail_type=container_exit 重 spawn → resolveAccount
 * 不知道账号坏了 → 同一个坏账号被反复选中 → fix loop 空转烧光 fix_round。
 *
 * 修复：
 *   1. spawnNode 把 resolveAccount 选出的 accountId 写进 state（TaskState.accountId）。
 *   2. awaitCallbackNode exit≠0 时跑 checkAuthFailure（cap-marking middleware）：
 *      命中 401 特征 → markAuthFailure(accountId) → 下次 spawn resolveAccount 换号。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInterrupt = vi.fn();
vi.mock('@langchain/langgraph', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, interrupt: (...a) => mockInterrupt(...a) };
});

const mockMarkAuthFailure = vi.fn();
vi.mock('../../account-usage.js', () => ({
  markAuthFailure: (...a) => mockMarkAuthFailure(...a),
  markSpendingCap: vi.fn(),
}));

const mockResolveAccount = vi.fn();
vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: (...a) => mockResolveAccount(...a),
}));

const mockEnsureWorktree = vi.fn();
vi.mock('../../harness-worktree.js', () => ({
  ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a),
  harnessSubTaskBranchName: (initiativeId, logical) => `cp-mock-${String(initiativeId).slice(0, 8)}-${logical}`,
  harnessSubTaskWorktreePath: () => '/mock-wt',
  cleanupHarnessWorktree: vi.fn(),
}));
const mockResolveToken = vi.fn();
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveToken(...a) }));
const mockSpawnDetached = vi.fn();
vi.mock('../../spawn/detached.js', () => ({
  spawnDockerDetached: (...a) => mockSpawnDetached(...a),
  spawnCodexBridgeDetached: vi.fn(),
}));
const mockPoolQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: (...a) => mockPoolQuery(...a) } }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({}),
}));

import { spawnNode, awaitCallbackNode, routeAfterCallback, TaskState } from '../harness-task.graph.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mockEnsureWorktree.mockResolvedValue('/wt');
  mockResolveToken.mockResolvedValue('ghp_x');
  mockSpawnDetached.mockResolvedValue({});
});

describe('spawnNode — accountId 写进 state（轮换闭环前提）', () => {
  it('resolveAccount 选号后 delta.accountId = CECELIA_CREDENTIALS', async () => {
    mockResolveAccount.mockImplementation(async (opts) => {
      opts.env.CECELIA_CREDENTIALS = 'account3';
      opts.env.CECELIA_MODEL = 'claude-sonnet-4-6';
    });
    const delta = await spawnNode({
      task: { id: 'ws1', title: 'T', payload: { parent_task_id: 'init-1' } },
      initiativeId: 'init-1',
    });
    expect(delta.error).toBeUndefined();
    expect(delta.accountId).toBe('account3');
  });

  it('TaskState 含 accountId annotation（checkpoint 持久化）', () => {
    expect(TaskState.spec.accountId).toBeDefined();
  });
});

describe('awaitCallbackNode — 401 auth 分类', () => {
  it('callback exit≠0 且含 401 特征 → checkAuthFailure 被调 + ci_fail_type=auth_failed', async () => {
    mockInterrupt.mockReturnValue({
      exit_code: 1,
      error: 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired"}}',
      stdout: '',
    });
    const checkAuthFailureMock = vi.fn(async () => ({ authFailed: true, account: 'account3' }));
    const delta = await awaitCallbackNode(
      { containerId: 'c1', accountId: 'account3' },
      { checkAuthFailure: checkAuthFailureMock },
    );
    expect(checkAuthFailureMock).toHaveBeenCalledTimes(1);
    // 账号要透传给 middleware（它负责 markAuthFailure）
    const [, optsArg] = checkAuthFailureMock.mock.calls[0];
    expect(optsArg.env.CECELIA_CREDENTIALS).toBe('account3');
    expect(delta.ci_status).toBe('fail');
    expect(delta.ci_fail_type).toBe('auth_failed');
  });

  it('非 auth 失败 → ci_fail_type 保持 container_exit', async () => {
    mockInterrupt.mockReturnValue({ exit_code: 1, error: 'npm test failed', stdout: '' });
    const checkAuthFailureMock = vi.fn(async () => ({ authFailed: false, account: null }));
    const delta = await awaitCallbackNode(
      { containerId: 'c1', accountId: 'account3' },
      { checkAuthFailure: checkAuthFailureMock },
    );
    expect(delta.ci_status).toBe('fail');
    expect(delta.ci_fail_type).toBe('container_exit');
  });

  it('默认接线：401 payload + state.accountId → markAuthFailure(accountId, null, api_error)', async () => {
    mockInterrupt.mockReturnValue({
      exit_code: 1,
      error: 'api_error_status: 401 unauthorized',
      stdout: '',
    });
    const delta = await awaitCallbackNode({ containerId: 'c2', accountId: 'account5' });
    expect(mockMarkAuthFailure).toHaveBeenCalledWith('account5', null, 'api_error');
    expect(delta.ci_fail_type).toBe('auth_failed');
  });

  it('routeAfterCallback: auth_failed 必须走 fix（重 spawn 换号），不能掉进 parse→no_pr 终止', () => {
    expect(routeAfterCallback({ ci_status: 'fail', ci_fail_type: 'auth_failed' })).toBe('fix');
    expect(routeAfterCallback({ ci_status: 'fail', ci_fail_type: 'container_exit' })).toBe('fix');
    expect(routeAfterCallback({})).toBe('parse');
  });

  it('exit=0 正常路径不跑 auth 检测', async () => {
    mockInterrupt.mockReturnValue({ exit_code: 0, stdout: 'pr_url: x' });
    const delta = await awaitCallbackNode({ containerId: 'c3', accountId: 'account1' });
    expect(mockMarkAuthFailure).not.toHaveBeenCalled();
    expect(delta.generator_output).toBe('pr_url: x');
  });
});
