import { describe, it, expect, vi } from 'vitest';
import { finalEvaluateDispatchNode } from '../harness-initiative.graph.js';

describe('finalEvaluateDispatchNode — B41 playground sync', () => {
  it('spawn executor 前调用 git fetch origin main + git checkout origin/main -- playground/', async () => {
    const gitCalls = [];
    const mockExecFile = vi.fn(async (_cmd, args, _opts) => {
      gitCalls.push(args);
      return { stdout: '', stderr: '' };
    });

    // executor 返回 exit_code=1（避免走 readBrainResult 真读文件）
    const mockExecutor = vi.fn(async () => ({ exit_code: 1, timed_out: false, stderr: 'test error' }));

    const state = {
      worktreePath: '/fake/worktree',
      task: { id: 'task-id-123', payload: {} },
      taskPlan: { journey_type: 'autonomous' },
      sub_tasks: [],
      initiativeId: 'init-id-456',
      githubToken: 'tok',
      contractBranch: null,
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, {
      executor: mockExecutor,
      execFile: mockExecFile,
    });

    // 验证 git fetch origin main 被调
    expect(gitCalls).toContainEqual(['fetch', 'origin', 'main']);
    // 验证 git checkout origin/main -- playground/ 被调
    expect(gitCalls).toContainEqual(['checkout', 'origin/main', '--', 'playground/']);
    // 验证顺序：fetch 在 checkout 之前
    const fetchIdx = gitCalls.findIndex(a => a[0] === 'fetch' && a[1] === 'origin' && a[2] === 'main');
    const checkoutIdx = gitCalls.findIndex(a => a[0] === 'checkout' && a[1] === 'origin/main');
    expect(fetchIdx).toBeLessThan(checkoutIdx);
  });

  it('worktreePath 为 null 时跳过 git 操作（不抛错）', async () => {
    const mockExecFile = vi.fn();
    const mockExecutor = vi.fn(async () => ({ exit_code: 1, timed_out: false, stderr: '' }));

    const state = {
      worktreePath: null,
      task: { id: 'task-id-null', payload: {} },
      taskPlan: { journey_type: 'autonomous' },
      sub_tasks: [],
      initiativeId: 'init-null',
      githubToken: 'tok',
      final_e2e_verdict: null,
    };

    await finalEvaluateDispatchNode(state, { executor: mockExecutor, execFile: mockExecFile });

    // git 命令不应被调用
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
