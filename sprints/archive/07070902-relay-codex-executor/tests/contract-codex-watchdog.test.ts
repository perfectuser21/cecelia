/**
 * B6 — watchdog attempts 上限按 orchestrator_host 分支（codex=2，claude=5）
 * Red 阶段：harness-relay-watchdog.js 使用固定 MAX_RELAY_ATTEMPTS=5，未按 host 分支，测试预期失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };

vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));

describe('B6: watchdog attempts 上限分支', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('orchestrator_host=skill-relay-codex + attempts=2 → 标 failed（达上限）', async () => {
    const initiativeId = 'aabbccdd-1234-5678-abcd-000000000010';
    const updatedQueries: string[] = [];

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT ON')) {
        // Return one codex run with attempts=2
        return {
          rows: [{
            initiative_id: initiativeId,
            phase: 'A_planning',
            deadline_at: new Date(Date.now() + 4 * 3600 * 1000), // 4h from now
            pr_url: null,
            orchestrator_host: 'skill-relay-codex',
            attempts: '2',
          }],
        };
      }
      if (sql.includes('SELECT id, status')) {
        return {
          rows: [{
            id: initiativeId,
            status: 'in_progress',
            title: 'codex task',
            description: null,
            payload: { orchestrator: 'skill-relay', executor: 'codex' },
            pr_url: null,
          }],
        };
      }
      if (sql.includes('UPDATE initiative_runs') || sql.includes('UPDATE tasks')) {
        updatedQueries.push(sql);
      }
      return { rows: [] };
    });

    const execFn = vi.fn(() => ''); // no running container

    const { resumeStalledRelayRuns } = await import('../../../packages/brain/src/harness-relay-watchdog.js');

    const result = await resumeStalledRelayRuns({
      pool: mockPool,
      execFn,
      spawnFn: vi.fn(),
    });

    // Should have capped (not resumed)
    expect(result.capped).toBeGreaterThan(0);
    expect(result.resumed).toBe(0);

    // initiative_runs and tasks should be marked failed
    const failedQuery = updatedQueries.find(
      (q) => q.includes('failed') && q.includes('relay_watchdog_attempt_cap')
    );
    expect(failedQuery).toBeDefined();
  });

  it('orchestrator_host=skill-relay-codex + attempts=1 → 重点火（未达上限 2）', async () => {
    const initiativeId = 'aabbccdd-1234-5678-abcd-000000000011';

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT ON')) {
        return {
          rows: [{
            initiative_id: initiativeId,
            phase: 'A_planning',
            deadline_at: new Date(Date.now() + 4 * 3600 * 1000),
            pr_url: null,
            orchestrator_host: 'skill-relay-codex',
            attempts: '1',
          }],
        };
      }
      if (sql.includes('SELECT id, status')) {
        return {
          rows: [{
            id: initiativeId,
            status: 'in_progress',
            title: 'codex task',
            description: null,
            payload: { orchestrator: 'skill-relay', executor: 'codex' },
            pr_url: null,
          }],
        };
      }
      return { rows: [] };
    });

    const execFn = vi.fn(() => ''); // no running container
    const spawnFn = vi.fn(async () => ({ ok: true, containerId: 'test-container' }));

    const { resumeStalledRelayRuns } = await import('../../../packages/brain/src/harness-relay-watchdog.js');

    const result = await resumeStalledRelayRuns({
      pool: mockPool,
      execFn,
      spawnFn,
    });

    expect(result.resumed).toBeGreaterThan(0);
    expect(result.capped).toBe(0);
  });

  it('orchestrator_host=skill-relay-session（claude）+ attempts=5 → 标 failed（上限仍是 5）', async () => {
    const initiativeId = 'aabbccdd-1234-5678-abcd-000000000012';
    const updatedQueries: string[] = [];

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT ON')) {
        return {
          rows: [{
            initiative_id: initiativeId,
            phase: 'A_planning',
            deadline_at: new Date(Date.now() + 4 * 3600 * 1000),
            pr_url: null,
            orchestrator_host: 'skill-relay-session',
            attempts: '5',
          }],
        };
      }
      if (sql.includes('SELECT id, status')) {
        return {
          rows: [{
            id: initiativeId,
            status: 'in_progress',
            title: 'claude task',
            description: null,
            payload: { orchestrator: 'skill-relay' },
            pr_url: null,
          }],
        };
      }
      if (sql.includes('UPDATE initiative_runs') || sql.includes('UPDATE tasks')) {
        updatedQueries.push(sql);
      }
      return { rows: [] };
    });

    const execFn = vi.fn(() => '');

    const { resumeStalledRelayRuns } = await import('../../../packages/brain/src/harness-relay-watchdog.js');

    const result = await resumeStalledRelayRuns({
      pool: mockPool,
      execFn,
      spawnFn: vi.fn(),
    });

    expect(result.capped).toBeGreaterThan(0);
  });

  it('orchestrator_host=skill-relay-session（claude）+ attempts=4 → 重点火（claude 上限是 5，未达）', async () => {
    const initiativeId = 'aabbccdd-1234-5678-abcd-000000000013';

    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT ON')) {
        return {
          rows: [{
            initiative_id: initiativeId,
            phase: 'A_planning',
            deadline_at: new Date(Date.now() + 4 * 3600 * 1000),
            pr_url: null,
            orchestrator_host: 'skill-relay-session',
            attempts: '4',
          }],
        };
      }
      if (sql.includes('SELECT id, status')) {
        return {
          rows: [{
            id: initiativeId,
            status: 'in_progress',
            title: 'claude task',
            description: null,
            payload: { orchestrator: 'skill-relay' },
            pr_url: null,
          }],
        };
      }
      return { rows: [] };
    });

    const execFn = vi.fn(() => '');
    const spawnFn = vi.fn(async () => ({ ok: true, containerId: 'test-container' }));

    const { resumeStalledRelayRuns } = await import('../../../packages/brain/src/harness-relay-watchdog.js');

    const result = await resumeStalledRelayRuns({
      pool: mockPool,
      execFn,
      spawnFn,
    });

    expect(result.resumed).toBeGreaterThan(0);
    expect(result.capped).toBe(0);
  });
});
