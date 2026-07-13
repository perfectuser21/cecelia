/**
 * B4 — spawn 失败回滚（无 run 行落库 + task 复位）
 * Red 阶段：harness-skill-relay.js executor=codex 路径尚未实现，测试预期失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };

vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../../packages/brain/src/harness-shared.js', () => ({
  loadSkillContent: vi.fn(() => '# harness-controller'),
  parseDockerOutput: vi.fn(() => ({})),
  extractField: vi.fn(() => null),
}));
vi.mock('../../../packages/brain/src/harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/workspace'),
}));
vi.mock('../../../packages/brain/src/spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn(async () => {}),
}));
vi.mock('../../../packages/brain/src/harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn(async () => 'ghp_test'),
}));

describe('B4: spawn 失败回滚', () => {
  const taskId = 'aabbccdd-1234-5678-abcd-000000000003';
  const baseTask = {
    id: taskId,
    title: 'codex spawn failure test',
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      initiative_id: taskId,
      journey_id: 'test-journey',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('spawnDockerDetached 抛出异常 → task 回滚为 queued + claimed_by=NULL', async () => {
    const queries: string[] = [];
    mockPool.query.mockImplementation(async (sql: string) => {
      queries.push(sql);
      // No concurrent runs
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });

    const spawnFn = vi.fn(async () => {
      throw new Error('docker daemon not available');
    });

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    const result = await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn: vi.fn(async () => ({ remaining_pct: 1.0 })),
    });

    // Should return failure
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();

    // Must have attempted to rollback task status to queued
    const rollbackQuery = queries.find(
      (q) => q.includes('UPDATE tasks') && q.includes('queued') && q.includes('claimed_by')
    );
    expect(rollbackQuery).toBeDefined();

    // Must NOT have inserted initiative_runs
    const runInsert = queries.find((q) => q.includes('INSERT INTO initiative_runs'));
    expect(runInsert).toBeUndefined();
  });

  it('spawn 失败 → 打印 [skill-relay][ALERT] 日志', async () => {
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });

    const spawnFn = vi.fn(async () => {
      throw new Error('container failed to start');
    });

    const consoleErrorSpy = vi.spyOn(console, 'error');

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn: vi.fn(async () => ({ remaining_pct: 1.0 })),
    });

    // Must print [skill-relay][ALERT] in error log
    const alertLog = consoleErrorSpy.mock.calls.find(
      (args) => String(args[0]).includes('[skill-relay][ALERT]')
    );
    expect(alertLog).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it('spawn 失败 → initiative_runs 无新行（不落库）', async () => {
    const insertCalls: string[] = [];
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('INSERT INTO initiative_runs')) {
        insertCalls.push(sql);
      }
      return { rows: [] };
    });

    const spawnFn = vi.fn(async () => {
      throw new Error('out of memory');
    });

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn: vi.fn(async () => ({ remaining_pct: 1.0 })),
    });

    expect(insertCalls.length).toBe(0);
  });
});
