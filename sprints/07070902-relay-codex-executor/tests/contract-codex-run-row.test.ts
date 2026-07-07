/**
 * B5 — initiative_runs 落行包含 orchestrator_host='skill-relay-codex' + 8h deadline
 * Red 阶段：harness-skill-relay.js 的 codex 路径尚未实现（当前硬编码 skill-relay-session + 6h），测试预期失败。
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

describe('B5: initiative_runs 落行 — codex 路径', () => {
  const taskId = 'aabbccdd-1234-5678-abcd-000000000004';
  const baseTask = {
    id: taskId,
    title: 'codex run row test',
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

  it("executor=codex → orchestrator_host='skill-relay-codex'（不是 skill-relay-session）", async () => {
    let capturedInsertSql = '';
    let capturedInsertParams: unknown[] = [];

    mockPool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('INSERT INTO initiative_runs')) {
        capturedInsertSql = sql;
        capturedInsertParams = params || [];
      }
      return { rows: [] };
    });

    const spawnFn = vi.fn(async () => {});

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn: vi.fn(async () => ({ remaining_pct: 1.0 })),
    });

    // The INSERT must have been called
    expect(capturedInsertSql).not.toBe('');

    // orchestrator_host must be 'skill-relay-codex' for codex executor
    expect(capturedInsertSql + JSON.stringify(capturedInsertParams)).toMatch(/skill-relay-codex/);
    // Must NOT use old 'skill-relay-session' for codex
    expect(capturedInsertSql + JSON.stringify(capturedInsertParams)).not.toMatch(/skill-relay-session/);
  });

  it('executor=codex → deadline = 8h（不是 6h）', async () => {
    let capturedInsertSql = '';

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('INSERT INTO initiative_runs')) {
        capturedInsertSql = sql;
      }
      return { rows: [] };
    });

    const spawnFn = vi.fn(async () => {});

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn: vi.fn(async () => ({ remaining_pct: 1.0 })),
    });

    // Deadline must reference 8 hours, not 6
    expect(capturedInsertSql).toMatch(/8\s+hours/i);
    expect(capturedInsertSql).not.toMatch(/6\s+hours/i);
  });

  it('executor=claude → orchestrator_host 仍为 skill-relay-session（原逻辑不变）', async () => {
    const claudeTask = {
      ...baseTask,
      id: 'aabbccdd-1234-5678-abcd-000000000005',
      payload: { ...baseTask.payload, executor: 'claude' },
    };

    let capturedInsertSql = '';
    let capturedInsertParams: unknown[] = [];

    mockPool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO initiative_runs')) {
        capturedInsertSql = sql;
        capturedInsertParams = params || [];
      }
      return { rows: [] };
    });

    const spawnFn = vi.fn(async () => {});

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    await spawnSkillRelaySession(claudeTask, {
      pool: mockPool,
      spawnFn,
    });

    // Claude path: should still use 'skill-relay-session'
    expect(capturedInsertSql + JSON.stringify(capturedInsertParams)).toMatch(/skill-relay-session/);
  });

  it('executor=codex → 容器名含 -cx 后缀', async () => {
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });

    let capturedSpawnOpts: Record<string, unknown> = {};
    const spawnFn = vi.fn(async (opts: Record<string, unknown>) => {
      capturedSpawnOpts = opts;
    });

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn: vi.fn(async () => ({ remaining_pct: 1.0 })),
    });

    // Container ID must end with -cx
    const containerId = capturedSpawnOpts.containerId as string | undefined;
    expect(containerId).toBeDefined();
    expect(containerId).toMatch(/-cx$/);
  });
});
