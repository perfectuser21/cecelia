import { describe, it, expect, vi } from 'vitest';

// ─── Mock all external dependencies ───────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { connect: vi.fn(), query: vi.fn() },
}));

vi.mock('@langchain/langgraph', () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class { addNode() { return this; } addEdge() { return this; } addConditionalEdges() { return this; } compile() { return { invoke: vi.fn() }; } },
    Annotation,
    START: '__start__',
    END: '__end__',
    interrupt: vi.fn(),
    Send: class { constructor(n, s) { this.node = n; this.state = s; } },
    MemorySaver: class {},
  };
});

vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(),
  harnessSubTaskBranchName: vi.fn(() => 'cp-test-branch'),
}));

vi.mock('../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn().mockResolvedValue('ghp_test_token'),
}));

vi.mock('../spawn/detached.js', () => ({
  spawnDockerDetached: vi.fn().mockResolvedValue({ containerId: 'test-container' }),
}));

vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ account: 'test-account' }),
}));

vi.mock('../shepherd.js', () => ({
  checkPrStatus: vi.fn(),
  classifyFailedChecks: vi.fn(),
}));

vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn((x) => x),
  extractField: vi.fn(),
  readPrFromGitState: vi.fn(),
  readVerdictFile: vi.fn(),
}));

vi.mock('../harness-utils.js', () => ({
  buildGeneratorPrompt: vi.fn(() => 'prompt'),
  extractWorkstreamIndex: vi.fn(() => 0),
}));

vi.mock('../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/contract-verify.js', () => ({
  verifyGeneratorOutput: vi.fn(),
}));

vi.mock('../workflows/retry-policies.js', () => ({
  LLM_RETRY: { maxAttempts: 3 },
}));

// ─── Import SUT after mocks ────────────────────────────────────────────────────

import { normalizeVerdict, mergePrNode, routeAfterMergePr } from '../workflows/harness-task.graph.js';

describe('normalizeVerdict — Protocol v1 + v2 统一标准化', () => {
  it('"FIXED" → "PASS"', () => {
    expect(normalizeVerdict('FIXED')).toBe('PASS');
  });

  it('"APPROVED" → "PASS"', () => {
    expect(normalizeVerdict('APPROVED')).toBe('PASS');
  });

  it('"PASS" → "PASS"', () => {
    expect(normalizeVerdict('PASS')).toBe('PASS');
  });

  it('"FAIL" → "FAIL"', () => {
    expect(normalizeVerdict('FAIL')).toBe('FAIL');
  });

  it('"GARBAGE" → "FAIL"', () => {
    expect(normalizeVerdict('GARBAGE')).toBe('FAIL');
  });

  it('空字符串 → "FAIL"', () => {
    expect(normalizeVerdict('')).toBe('FAIL');
  });

  it('大小写不敏感：lowercase "fixed" → "PASS"', () => {
    expect(normalizeVerdict('fixed')).toBe('PASS');
  });
});

describe('mergePrNode — 合并命令不含 --auto', () => {
  it('gh pr merge 参数不含 --auto', async () => {
    const captured = [];
    const execFn = async (_cmd, args) => {
      captured.push(...args);
      return { stdout: 'PR merged' };
    };
    const state = { pr_url: 'https://github.com/perfectuser21/cecelia/pull/999' };
    await mergePrNode(state, { execFile: execFn });
    expect(captured).not.toContain('--auto');
    expect(captured).toContain('--squash');
    expect(captured).toContain('--delete-branch');
  });
});

describe('mergePrNode — branch-behind retry', () => {
  const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/999';

  it('behind 错误首次 → update-branch + 返回 ci_status=pending rebase_attempted=1', async () => {
    const calls = [];
    const execFn = async (_cmd, args) => {
      calls.push([...args]);
      if (args.includes('merge')) throw new Error('branch is behind the base branch by 2 commits');
      return { stdout: '' };
    };
    const result = await mergePrNode({ pr_url: PR_URL, rebase_attempted: 0 }, { execFile: execFn });
    expect(calls[0]).toContain('merge');
    expect(calls[1]).toContain('update-branch');
    expect(calls[1]).toContain('--rebase');
    expect(result.ci_status).toBe('pending');
    expect(result.rebase_attempted).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('behind 错误但 rebase_attempted=1 → 返回 error（已重试过）', async () => {
    const execFn = async () => { throw new Error('must be up to date with the base branch'); };
    const result = await mergePrNode({ pr_url: PR_URL, rebase_attempted: 1 }, { execFile: execFn });
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('merge_pr');
    expect(result.error.message).toMatch(/after rebase/i);
  });

  it('behind 错误 update-branch 也失败 → 返回 error', async () => {
    const execFn = async (_cmd, args) => {
      if (args.includes('merge')) throw new Error('head ref is out of date');
      throw new Error('merge conflict: cannot rebase');
    };
    const result = await mergePrNode({ pr_url: PR_URL, rebase_attempted: 0 }, { execFile: execFn });
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('merge_pr');
    expect(result.error.message).toMatch(/update-branch failed/i);
  });

  it('非 behind 错误 → 返回 error（不再是 merge_error）', async () => {
    const execFn = async () => { throw new Error('GraphQL: Permission denied to merge'); };
    const result = await mergePrNode({ pr_url: PR_URL, rebase_attempted: 0 }, { execFile: execFn });
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('merge_pr');
    expect(result.merge_error).toBeUndefined();
  });

  it('no pr_url → 返回 error（不再是 merge_error）', async () => {
    const result = await mergePrNode({ pr_url: null, rebase_attempted: 0 }, { execFile: async () => ({}) });
    expect(result.error).toBeDefined();
    expect(result.error.node).toBe('merge_pr');
    expect(result.merge_error).toBeUndefined();
  });
});

describe('routeAfterMergePr', () => {
  it('status=merged → end', () => {
    expect(routeAfterMergePr({ status: 'merged' })).toBe('end');
  });

  it('ci_status=pending（rebase done）→ poll', () => {
    expect(routeAfterMergePr({ ci_status: 'pending', rebase_attempted: 1 })).toBe('poll');
  });

  it('error set → end', () => {
    expect(routeAfterMergePr({ error: { node: 'merge_pr', message: 'x' } })).toBe('end');
  });
});
