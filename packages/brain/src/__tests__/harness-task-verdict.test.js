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

import { normalizeVerdict, mergePrNode } from '../workflows/harness-task.graph.js';

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
