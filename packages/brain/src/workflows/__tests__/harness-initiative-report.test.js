/**
 * reportNode failure_reason 截断修复测试（B46）
 *
 * 覆盖：
 * 1. evaluator_feedback 200字符 → failure_reason 完整保留（不再被砍到80字符）
 * 2. 极端情况（evaluator_feedback > 5000字符）仍有兜底截断（≤ 2000 per sub_task）
 * 3. 整体 detail 的新上限 4000 生效
 */
import { describe, it, expect, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockSpawnDetached = vi.fn().mockResolvedValue(undefined);
const mockInterrupt = vi.fn();
const mockDbQuery = vi.fn().mockResolvedValue({ rows: [] });
const mockResolveAccount = vi.fn().mockResolvedValue(undefined);
const mockEnsureWorktree = vi.fn();
const mockResolveToken = vi.fn();
const mockParseTaskPlan = vi.fn();
const mockUpsertTaskPlan = vi.fn();
const mockRunGan = vi.fn();
const mockReadFile = vi.fn();

vi.mock('../../spawn/index.js', () => ({ spawn: (...a) => mockSpawn(...a) }));
vi.mock('../../spawn/detached.js', () => ({ spawnDockerDetached: (...a) => mockSpawnDetached(...a) }));
vi.mock('../../db.js', () => ({ default: { query: (...a) => mockDbQuery(...a) } }));
vi.mock('../../spawn/middleware/account-rotation.js', () => ({ resolveAccount: (...a) => mockResolveAccount(...a) }));
vi.mock('@langchain/langgraph', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, interrupt: (...a) => mockInterrupt(...a) };
});
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: (...a) => mockEnsureWorktree(...a) }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: (...a) => mockResolveToken(...a) }));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL CONTENT',
  readBrainResult: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: (...a) => mockParseTaskPlan(...a),
  upsertTaskPlan: (...a) => mockUpsertTaskPlan(...a),
}));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: (...a) => mockRunGan(...a) }));
vi.mock('node:fs/promises', () => ({ default: { readFile: (...a) => mockReadFile(...a) }, readFile: (...a) => mockReadFile(...a) }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    setup: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    getTuple: vi.fn().mockResolvedValue(null),
    putWrites: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { reportNode } from '../harness-initiative.graph.js';

function makePool() {
  const dbQueryMock = vi.fn().mockResolvedValue({ rows: [] });
  const mockPool = {
    connect: vi.fn().mockResolvedValue({ query: dbQueryMock, release: vi.fn() }),
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return { mockPool, dbQueryMock };
}

function getFailureReason(dbQueryMock) {
  const runUpdate = dbQueryMock.mock.calls.find(c => /UPDATE initiative_runs/.test(c[0]));
  expect(runUpdate, 'initiative_runs UPDATE call should exist').toBeTruthy();
  // [initiativeId, phase, reason] — phase='failed', reason 是第3个参数
  return runUpdate[1][2];
}

describe('reportNode — B46 failure_reason 截断修复', () => {
  it('evaluator_feedback 200字符 → failure_reason 完整保留（不再被砍到80字符）', async () => {
    const { mockPool, dbQueryMock } = makePool();
    // 构造一个恰好 200 字符的 feedback
    const longFeedback = 'X'.repeat(200);
    const state = {
      initiativeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      sub_tasks: [
        { id: 'ws1', status: 'failed', pr_url: null, ci_fail_type: null, evaluator_feedback: longFeedback },
      ],
      final_e2e_verdict: null,
      final_e2e_failed_scenarios: [],
    };
    await reportNode(state, { pool: mockPool, _checkPrMerged: async () => false, execFile: async () => ({ stdout: '' }) });
    const reason = getFailureReason(dbQueryMock);
    expect(reason).toBeTruthy();
    expect(reason.startsWith('Final E2E FAIL:')).toBe(true);
    // 完整 200 字符必须出现在 failure_reason 内（不再被80字符截断）
    expect(reason).toContain(longFeedback);
  });

  it('evaluator_feedback 超过5000字符时 failure_reason 仍有兜底截断（≤ 2000 per sub_task）', async () => {
    const { mockPool, dbQueryMock } = makePool();
    const extremeFeedback = 'Y'.repeat(6000);
    const state = {
      initiativeId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      sub_tasks: [
        { id: 'ws1', status: 'failed', pr_url: null, ci_fail_type: null, evaluator_feedback: extremeFeedback },
      ],
      final_e2e_verdict: null,
      final_e2e_failed_scenarios: [],
    };
    await reportNode(state, { pool: mockPool, _checkPrMerged: async () => false, execFile: async () => ({ stdout: '' }) });
    const reason = getFailureReason(dbQueryMock);
    expect(reason).toBeTruthy();
    // 极端情况下整体 reason 不会超过合理上限（prefix + detail <= ~4100）
    expect(reason.length).toBeLessThanOrEqual(4100);
    // 但必须包含 6000 字符 feedback 的至少前 2000 字符（兜底截断上限）
    expect(reason).toContain('Y'.repeat(2000));
    // 不包含完整的 6000 字符（确认截断生效）
    expect(reason).not.toContain('Y'.repeat(6000));
  });

  it('整体 detail 超过4000字符时 failure_reason 在4000处截断', async () => {
    const { mockPool, dbQueryMock } = makePool();
    // 3 个 sub_task 各带 600 字符 feedback → 拼接后 detail >> 4000
    const sub_tasks = Array.from({ length: 3 }, (_, i) => ({
      id: `ws${i + 1}`,
      status: 'failed',
      pr_url: null,
      ci_fail_type: null,
      evaluator_feedback: `T${i}`.repeat(600),
    }));
    const state = {
      initiativeId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      sub_tasks,
      final_e2e_verdict: null,
      final_e2e_failed_scenarios: [],
    };
    await reportNode(state, { pool: mockPool, _checkPrMerged: async () => false, execFile: async () => ({ stdout: '' }) });
    const reason = getFailureReason(dbQueryMock);
    expect(reason).toBeTruthy();
    expect(reason.startsWith('Final E2E FAIL:')).toBe(true);
    // detail 部分 ≤ 4000，加上前缀 "Final E2E FAIL: " (16字符) → 总长 ≤ 4016
    expect(reason.length).toBeLessThanOrEqual(4016);
  });
});
