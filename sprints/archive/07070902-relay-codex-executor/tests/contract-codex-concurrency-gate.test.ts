/**
 * B2 — 双层并发守门 MAX=1
 * Red 阶段：harness-skill-relay.js 尚无 _activeCodexRelays + DB 守门逻辑，测试预期失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We import the function we expect to be modified
// The function currently does NOT have codex concurrency gating, so tests will fail

const mockPool = { query: vi.fn() };

vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../../packages/brain/src/harness-shared.js', () => ({
  loadSkillContent: vi.fn(() => '# harness-controller skill content'),
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

describe('B2: 双层并发守门 executor=codex MAX=1', () => {
  const baseTask = {
    id: 'aabbccdd-1234-5678-abcd-000000000001',
    title: 'codex relay test',
    payload: {
      orchestrator: 'skill-relay',
      executor: 'codex',
      initiative_id: 'aabbccdd-1234-5678-abcd-000000000001',
      journey_id: 'test-journey',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('DB 层：有活跃 codex run 时 → defer，不烧 attempts', async () => {
    // Simulate: DB returns 1 active skill-relay-codex run
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('skill-relay-codex') && sql.includes('COUNT')) {
        return { rows: [{ count: '1' }] };
      }
      return { rows: [] };
    });

    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');
    const spawnFn = vi.fn();

    const result = await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
    });

    // Expected: deferred due to concurrent codex run
    expect(result.ok).toBe(false);
    expect(result.deferred).toBe(true);
    expect(result.reason).toMatch(/codex_concurrent_limit/);
    // spawn must NOT have been called
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('DB 层：initiative_id 自身排除后 count=0 → 允许 spawn', async () => {
    // Simulate: DB excludes self, returns 0 active runs
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('skill-relay-codex') && sql.includes('COUNT')) {
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

    const spawnFn = vi.fn(async () => {});
    const { spawnSkillRelaySession } = await import('../../../packages/brain/src/harness-skill-relay.js');

    const result = await spawnSkillRelaySession(baseTask, {
      pool: mockPool,
      spawnFn,
    });

    // With count=0, spawn should proceed (ok=true or at least spawnFn called)
    expect(spawnFn).toHaveBeenCalled();
  });

  it('进程内守门：_activeCodexRelays > 0 → 立即 defer，不查 DB', async () => {
    // This test verifies the in-process gate fires before DB query
    // Currently no such in-process lock exists → test will fail

    // Simulate: spawn is called while _activeCodexRelays is already 1
    // We test by inspecting that DB count query is NOT called when in-process gate fires
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT') && sql.includes('skill-relay-codex')) {
        throw new Error('DB should not be queried when in-process gate fires');
      }
      return { rows: [] };
    });

    const { spawnSkillRelaySession, _setActiveCodexRelays } = await import('../../../packages/brain/src/harness-skill-relay.js') as any;

    if (typeof _setActiveCodexRelays === 'function') {
      _setActiveCodexRelays(1); // Set in-process counter to 1
    } else {
      // If _setActiveCodexRelays doesn't exist, the in-process gate isn't implemented yet
      // This assertion will fail, marking test as Red
      expect(_setActiveCodexRelays).toBeDefined();
    }

    const spawnFn = vi.fn();
    const result = await spawnSkillRelaySession(baseTask, { pool: mockPool, spawnFn });

    expect(result.ok).toBe(false);
    expect(result.deferred).toBe(true);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
