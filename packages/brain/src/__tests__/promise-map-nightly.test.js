/**
 * TDD: MJ5 刀4 S4 保鲜对账（nightly）
 *
 * BEHAVIOR 覆盖（8 条）:
 *  [S4-N1] 不在时间窗口 → skipped
 *  [S4-N2] 已运行当日 → skipped（哨兵去重）
 *  [S4-N3] 带锚 PR 昨日 merge，格子已回写 green → A1 pass
 *  [S4-N4] 带锚 PR 昨日 merge，格子未回写 → A1 fail + Bark
 *  [S4-N5] 昨日无锚 merge PR = 0 → A2 pass
 *  [S4-N6] 昨日有无锚 merge PR → A2 fail + Bark
 *  [S4-N7] 所有断言通过 → 写 sentinel，返回 failures=0
 *  [S4-N8] 三闸心跳——闸文件存在 → A4 pass
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── mock pool ─────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));

// ── mock notifier ─────────────────────────────────────────
const mockSendBark = vi.fn();
vi.mock('../notifier.js', () => ({ sendBark: (...a) => mockSendBark(...a) }));

// ── mock fs (A4 gate heartbeat) ───────────────────────────
import { existsSync } from 'node:fs';
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));

import {
  runPromiseMapNightly,
  buildNightlyAssertions,
  SENTINEL_KEY,
  NIGHTLY_HOUR_UTC,
} from '../promise-map-nightly.js';

function makePool(queryImpl) {
  return { query: queryImpl };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSendBark.mockResolvedValue(undefined);
  existsSync.mockReturnValue(true);
});

// ── [S4-N1] 时间窗口外 → skipped ─────────────────────────
describe('[S4-N1] 时间窗口外', () => {
  it('returns skipped when not in nightly hour', async () => {
    const outsideHour = (NIGHTLY_HOUR_UTC + 1) % 24;
    const now = new Date(`2026-07-18T${String(outsideHour).padStart(2, '0')}:00:00Z`);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // sentinel check (shouldn't be called)
    const result = await runPromiseMapNightly(now);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('outside_window');
  });
});

// ── [S4-N2] 哨兵去重 ─────────────────────────────────────
describe('[S4-N2] 哨兵已存在（当日已跑）', () => {
  it('returns skipped when sentinel is recent', async () => {
    const now = new Date(`2026-07-18T${String(NIGHTLY_HOUR_UTC).padStart(2, '0')}:00:00Z`);
    const recentTs = new Date(now.getTime() - 1000 * 60 * 30).toISOString(); // 30 min ago
    mockQuery.mockResolvedValueOnce({
      rows: [{ value_json: { last_run_at: recentTs } }],
    });
    const result = await runPromiseMapNightly(now);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_ran_today');
  });
});

// ── buildNightlyAssertions unit tests ─────────────────────

describe('[S4-N3] A1 带锚 PR 格子已回写 green → pass', () => {
  it('A1 passes when all anchored PRs have green cells', async () => {
    const pool = makePool(vi.fn()
      // A1 query: anchored dev_records
      .mockResolvedValueOnce({ rows: [{ task_id: 'tid1', step_id: 'sid1', pr_url: 'http://gh/1' }] })
      // A1 check cell_status for sid1
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      // A2 query: unanchored count
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      // A3 base features without links
      .mockResolvedValueOnce({ rows: [] })
      // A3 steps without promise
      .mockResolvedValueOnce({ rows: [] })
      // sentinel write
      .mockResolvedValueOnce({ rows: [] })
    );
    const assertions = await buildNightlyAssertions(pool);
    const a1 = assertions.find(a => a.key === 'anchor_cell_writeback');
    expect(a1.ok).toBe(true);
    expect(a1.detail).toMatch(/1.*带锚/);
  });
});

describe('[S4-N4] A1 格子未回写 → fail + Bark', () => {
  it('A1 fails when anchored PR has no green cell', async () => {
    const pool = makePool(vi.fn()
      .mockResolvedValueOnce({ rows: [{ task_id: 'tid1', step_id: 'sid1', pr_url: 'http://gh/1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // no green cell
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    );
    const assertions = await buildNightlyAssertions(pool);
    const a1 = assertions.find(a => a.key === 'anchor_cell_writeback');
    expect(a1.ok).toBe(false);
    expect(a1.detail).toMatch(/未回写/);
  });
});

describe('[S4-N5] A2 无锚 merge PR = 0 → pass', () => {
  it('A2 passes when no unanchored merges yesterday', async () => {
    const pool = makePool(vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // A1: no anchored PRs
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // A2
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    );
    const assertions = await buildNightlyAssertions(pool);
    const a2 = assertions.find(a => a.key === 'zero_unanchored_merges');
    expect(a2.ok).toBe(true);
  });
});

describe('[S4-N6] A2 有无锚 merge PR → fail', () => {
  it('A2 fails when unanchored merges exist', async () => {
    const pool = makePool(vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // 2 unanchored
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    );
    const assertions = await buildNightlyAssertions(pool);
    const a2 = assertions.find(a => a.key === 'zero_unanchored_merges');
    expect(a2.ok).toBe(false);
    expect(a2.detail).toMatch(/2/);
  });
});

describe('[S4-N7] 全部通过 → sentinel 写入，返回 failures=0', () => {
  it('writes sentinel and returns 0 failures when all pass', async () => {
    const now = new Date(`2026-07-18T${String(NIGHTLY_HOUR_UTC).padStart(2, '0')}:00:00Z`);
    mockQuery
      // sentinel read: not found
      .mockResolvedValueOnce({ rows: [] })
      // A1: no anchored PRs
      .mockResolvedValueOnce({ rows: [] })
      // A2: 0 unanchored
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      // A3a: no base features without links
      .mockResolvedValueOnce({ rows: [] })
      // A3b: no steps without promise
      .mockResolvedValueOnce({ rows: [] })
      // sentinel write
      .mockResolvedValueOnce({ rows: [] });

    const result = await runPromiseMapNightly(now);
    expect(result.ran).toBe(true);
    expect(result.failures).toBe(0);
    expect(mockSendBark).not.toHaveBeenCalled();
    // sentinel write should have been called
    const sentinelWrite = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO working_memory'),
    );
    expect(sentinelWrite).toBeTruthy();
  });
});

describe('[S4-N8] A4 三闸心跳——闸文件存在', () => {
  it('A4 passes when gate files exist', async () => {
    const pool = makePool(vi.fn()
      .mockResolvedValueOnce({ rows: [] }) // A1
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // A2
      .mockResolvedValueOnce({ rows: [] }) // A3a
      .mockResolvedValueOnce({ rows: [] }) // A3b
    );
    existsSync.mockReturnValue(true);
    const assertions = await buildNightlyAssertions(pool);
    const a4 = assertions.find(a => a.key === 'gate_heartbeat');
    expect(a4.ok).toBe(true);
    expect(a4.detail).toMatch(/3.*闸/);
  });

  it('A4 fails when a gate file is missing', async () => {
    const pool = makePool(vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    );
    existsSync.mockReturnValue(false);
    const assertions = await buildNightlyAssertions(pool);
    const a4 = assertions.find(a => a.key === 'gate_heartbeat');
    expect(a4.ok).toBe(false);
    expect(a4.detail).toMatch(/缺失/);
  });
});
