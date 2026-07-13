/**
 * B3 — 额度软闸 defer（team2 quota < 30%）
 * Red 阶段：harness-skill-relay.js 尚无 quota 软闸逻辑，测试预期失败。
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

describe('B3: team2 quota 软闸', () => {
  const baseTask = {
    id: 'aabbccdd-1234-5678-abcd-000000000002',
    title: 'codex quota test',
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      initiative_id: 'aabbccdd-1234-5678-abcd-000000000002',
      journey_id: 'test-journey',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: no concurrent runs
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });
  });

  it('quota 剩余 < 30% → defer reason=codex_quota_low，不烧 attempts', async () => {
    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');
    const spawnFn = vi.fn();

    // Inject a quota checker that returns < 30% remaining
    const quotaFn = vi.fn(async () => ({ remaining_pct: 0.20, total_hours: 5, used_hours: 4 }));

    const result = await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn, // Expected new dep injection point
    });

    // Should defer due to low quota
    expect(result.ok).toBe(false);
    expect(result.deferred).toBe(true);
    expect(result.reason).toMatch(/codex_quota_low/);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('quota 剩余 >= 30% → 不软闸，继续 spawn', async () => {
    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');
    const spawnFn = vi.fn(async () => {});

    const quotaFn = vi.fn(async () => ({ remaining_pct: 0.50, total_hours: 5, used_hours: 2.5 }));

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('INSERT INTO initiative_runs')) {
        return { rows: [] };
      }
      if (sql.includes('UPDATE tasks')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn,
    });

    // Spawn should be called when quota is sufficient
    expect(spawnFn).toHaveBeenCalled();
  });

  it('quota 查询失败 → 保守通过（不阻塞 spawn）', async () => {
    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');
    const spawnFn = vi.fn(async () => {});

    const quotaFn = vi.fn(async () => { throw new Error('quota API unavailable'); });

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('INSERT INTO initiative_runs')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
      quotaFn,
    });

    // Quota check failure should not block spawn (conservative pass)
    expect(spawnFn).toHaveBeenCalled();
  });

  it('executor=claude 不走 quota 软闸', async () => {
    const claudeTask = {
      ...baseTask,
      id: 'aabbccdd-1234-5678-abcd-000000000099',
      payload: { ...baseTask.payload, executor: 'claude' },
    };

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');
    const spawnFn = vi.fn(async () => {});
    const quotaFn = vi.fn(async () => ({ remaining_pct: 0.05 })); // Very low quota

    mockPool.query.mockImplementation(async () => ({ rows: [] }));

    const result = await spawnSkillRelaySession(claudeTask, {
      pool: mockPool,
      spawnFn,
      quotaFn,
    });

    // quota check should not be called for claude executor
    expect(quotaFn).not.toHaveBeenCalled();
  });
});
