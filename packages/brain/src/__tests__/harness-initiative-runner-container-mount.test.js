import { describe, it, expect, vi } from 'vitest';

describe('runInitiative container mount', () => {
  it('passes worktreePath and GITHUB_TOKEN to executor', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'ghs_test_token'),
    }));

    let captured = null;
    const mockExec = async (opts) => {
      captured = opts;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({
          type: 'result',
          result: '```json\n{"initiative_id":"i","tasks":[{"logical_task_id":"ws1","title":"t","complexity":"S","files":[],"dod":[]}]}\n```',
        }),
        stderr: '',
      };
    };

    const { runInitiative } = await import('../harness-initiative-runner.js');
    await runInitiative(
      { id: 'abcdef1234567890-xxx', title: 'x', description: 'y' },
      {
        executor: mockExec,
        pool: { connect: async () => ({
          query: async () => ({ rows: [{ id: 'contract-id' }] }),
          release: () => {},
        })},
      }
    );

    expect(captured).not.toBeNull();
    expect(captured.worktreePath).toBeTruthy();
    expect(captured.worktreePath).toContain('harness-v2');
    expect(captured.env.GITHUB_TOKEN).toBe('ghs_test_token');
  });

  it('fails fast when token unavailable', async () => {
    vi.resetModules();
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => { throw new Error('github_token_unavailable'); }),
    }));

    const mockExec = vi.fn();
    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'abcdef1234567890-xxx', title: 'x', description: 'y' },
      { executor: mockExec }
    );

    expect(res.success).toBe(false);
    expect(String(res.error || '')).toMatch(/github_token_unavailable/);
    expect(mockExec).not.toHaveBeenCalled();
  });
});
