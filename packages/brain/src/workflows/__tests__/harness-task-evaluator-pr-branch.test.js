/**
 * B14 — evaluator spawn env 必须含 PR_BRANCH。
 *
 * 根因（W19-W36 9 次实证）：brain 把 evaluator 起在 initiative 主 worktree（main 分支），
 * 没把 PR 分支名透传给 container，evaluator skill 没办法 git checkout 到 PR 分支，
 * 跑 server 看不到 generator 在 PR 分支写的代码 → 永远 FAIL。
 *
 * 修复：evaluateContractNode 把 state.pr_branch（或 gh pr view fallback）写进 spawn env.PR_BRANCH，
 * evaluator skill Step 0a 用这个 env 做 git checkout。
 */
import { describe, it, expect, vi } from 'vitest';

// resolveAccount 需要 mock（不然会真去查 account-usage 表）。
vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
}));
// account-usage 也 mock 兜底（resolveAccount 内部 dynamic import）。
vi.mock('../../account-usage.js', () => ({
  isSpendingCapped: () => false,
  isAuthFailed: () => false,
  selectBestAccount: vi.fn().mockResolvedValue(null),
}));

const { evaluateContractNode } = await import('../harness-task.graph.js');

describe('B14: evaluator spawn env 含 PR_BRANCH', () => {
  it('当 state.pr_branch 有值时，spawn env.PR_BRANCH = state.pr_branch', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const resolveToken = vi.fn().mockResolvedValue('fake-token');
    const poolOverride = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    // evaluateContractNode 内部 interrupt() 会 throw GraphInterrupt（langgraph 设计），
    // 我们在 spawn 之后才 interrupt，所以 spawn 已被调用，再断言 env。
    await evaluateContractNode(
      {
        task: { id: 'test-task-uuid', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/x' } },
        initiativeId: 'test-init',
        pr_url: 'https://github.com/x/y/pull/123',
        pr_branch: 'cp-test-pr-branch',
        contractBranch: 'cp-proposer-branch',
        worktreePath: '/tmp/x',
        githubToken: 'fake-token',
        fix_round: 0,
      },
      { spawnDetached, resolveToken, poolOverride }
    ).catch(() => { /* interrupt 抛错 OK，spawn 已被调过 */ });

    expect(spawnDetached).toHaveBeenCalledOnce();
    const env = spawnDetached.mock.calls[0][0].env;
    expect(env.PR_BRANCH).toBe('cp-test-pr-branch');
    expect(env.PR_URL).toBe('https://github.com/x/y/pull/123');
  });
});
