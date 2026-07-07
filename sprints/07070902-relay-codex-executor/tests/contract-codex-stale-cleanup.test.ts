/**
 * TDD Red — B8: 8h 逾期 scanStuckHarness 收尸
 *
 * 验证 scanStuckHarness 对 deadline_at < NOW() 且 orchestrator_host='skill-relay-codex'
 * 的 run 行执行正确的收尸动作：
 *   - initiative_runs.phase → 'failed'
 *   - initiative_runs.failure_reason → 'relay_deadline_exceeded'
 *   - tasks.status → 'failed'
 *
 * 当前状态：RED（功能未实现，测试预期失败）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDb = {
  query: vi.fn(),
};

vi.mock('../../../../packages/brain/src/db.js', () => ({
  default: mockDb,
  query: (...args: unknown[]) => mockDb.query(...args),
}));

// ---------------------------------------------------------------------------
// Subject under test — will fail until scanStuckHarness is implemented
// ---------------------------------------------------------------------------

let scanStuckHarness: () => Promise<void>;

beforeEach(async () => {
  vi.resetAllMocks();
  // Dynamic import so mock is applied first
  const mod = await import('../../../../packages/brain/src/harness-relay-watchdog.js');
  scanStuckHarness = (mod as { scanStuckHarness: () => Promise<void> }).scanStuckHarness;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('B8 — scanStuckHarness codex deadline exceeded cleanup', () => {
  it('marks overdue codex run as failed with relay_deadline_exceeded', async () => {
    // Arrange: one overdue codex run returned by DB query
    const overdueRunId = 'run-overdue-001';
    const taskId = 'task-codex-001';

    mockDb.query
      // First call: SELECT overdue codex runs
      .mockResolvedValueOnce({
        rows: [
          {
            id: overdueRunId,
            initiative_id: taskId,
            orchestrator_host: 'skill-relay-codex',
            phase: 'A_planning',
            deadline_at: new Date(Date.now() - 9 * 60 * 60 * 1000), // 9h ago
          },
        ],
      })
      // Second call: UPDATE initiative_runs phase+failure_reason
      .mockResolvedValueOnce({ rowCount: 1 })
      // Third call: UPDATE tasks status
      .mockResolvedValueOnce({ rowCount: 1 });

    // Act
    await scanStuckHarness();

    // Assert: initiative_runs updated to failed + failure_reason
    const runUpdateCall = mockDb.query.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('initiative_runs') &&
        c[0].includes('failed') &&
        c[1]?.includes('relay_deadline_exceeded'),
    );
    expect(
      runUpdateCall,
      'Expected UPDATE initiative_runs SET phase=failed, failure_reason=relay_deadline_exceeded',
    ).toBeDefined();

    // Assert: tasks updated to failed
    const taskUpdateCall = mockDb.query.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('tasks') &&
        c[0].includes('failed') &&
        c[1]?.includes(taskId),
    );
    expect(
      taskUpdateCall,
      'Expected UPDATE tasks SET status=failed WHERE id=task-codex-001',
    ).toBeDefined();
  });

  it('does NOT touch non-codex overdue runs (orchestrator_host != skill-relay-codex)', async () => {
    // scanStuckHarness should filter by orchestrator_host='skill-relay-codex' in its SELECT
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // no rows for codex

    await scanStuckHarness();

    // Only one query (the SELECT), no UPDATE calls
    const updateCalls = mockDb.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].trim().toUpperCase().startsWith('UPDATE'),
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('does NOT clean up codex runs where deadline_at is still in the future', async () => {
    // Arrange: run with deadline 1h from now — should not be returned by the SELECT
    mockDb.query.mockResolvedValueOnce({ rows: [] }); // DB correctly returns empty

    await scanStuckHarness();

    const updateCalls = mockDb.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].trim().toUpperCase().startsWith('UPDATE'),
    );
    expect(updateCalls).toHaveLength(0);
  });
});
