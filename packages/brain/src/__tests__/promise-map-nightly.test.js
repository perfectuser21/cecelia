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

// ── [S4-N9] A3 底座件判定：家②/家③ group 而非 kind='base'（纸门修复）──
// journey_features.kind CHECK 只允许 ability|feature——kind='base' 永远查空=断言永绿。
describe('[S4-N9] A3 底座件按 group 家②/家③ 判定', () => {
  it('孤儿底座件（家③，无任何链接）→ A3 fail', async () => {
    const pool = makePool(vi.fn()
      .mockResolvedValueOnce({ rows: [] })                       // A1 anchored PRs
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })         // A2
      .mockResolvedValueOnce({ rows: [{ id: 'f1', name: '孤儿底座' }] }) // A3a 无链接底座件
      .mockResolvedValueOnce({ rows: [] })                       // A3b promise 缺失
    );
    const assertions = await buildNightlyAssertions(pool);
    const a3 = assertions.find(a => a.key === 'ledger_integrity');
    expect(a3.ok).toBe(false);
    expect(a3.detail).toMatch(/底座件/);
  });

  it('A3a 查询不再用 kind=base，按 group 家③/家② 收口', async () => {
    let a3aSql = '';
    const pool = makePool(vi.fn(async (sql) => {
      if (typeof sql === 'string' && sql.includes('journey_features jf')) { a3aSql = sql; return { rows: [] }; }
      if (typeof sql === 'string' && sql.includes('dev_records')) {
        return sql.includes('COUNT(*)') ? { rows: [{ count: '0' }] } : { rows: [] };
      }
      return { rows: [] };
    }));
    await buildNightlyAssertions(pool);
    expect(a3aSql).not.toContain("kind = 'base'");
    expect(a3aSql).toContain('家③横切件池');
    expect(a3aSql).toContain('家②共享前置');
  });
});

// ── [S4-N10] A3 promise 缺失只查承诺地图域（存量 34 个无 promise 旧步骤豁免）──
describe('[S4-N10] A3 promise 检查按域收口', () => {
  it('promise IS NULL 查询限定 home/domain 非空的 journey', async () => {
    let a3bSql = '';
    const pool = makePool(vi.fn(async (sql) => {
      if (typeof sql === 'string' && sql.includes('promise IS NULL')) { a3bSql = sql; return { rows: [] }; }
      if (typeof sql === 'string' && sql.includes('dev_records')) {
        return sql.includes('COUNT(*)') ? { rows: [{ count: '0' }] } : { rows: [] };
      }
      return { rows: [] };
    }));
    await buildNightlyAssertions(pool);
    expect(a3bSql).toContain('JOIN journeys');
    expect(a3bSql).toMatch(/home IS NOT NULL|domain IS NOT NULL/);
  });
});

// ── [S4-N11] A2 对齐 S2 豁免语义（legacy cutoff + 豁免 task_type/action）──
describe('[S4-N11] A2 旁路检测与 S2 闸同口径', () => {
  it('A2 查询带 legacy cutoff 参数与豁免过滤', async () => {
    let a2Sql = '';
    let a2Params = null;
    const pool = makePool(vi.fn(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('COUNT(*)') && sql.includes('dev_records')) {
        a2Sql = sql; a2Params = params; return { rows: [{ count: '0' }] };
      }
      if (typeof sql === 'string' && sql.includes('dev_records')) return { rows: [] };
      return { rows: [] };
    }));
    await buildNightlyAssertions(pool);
    expect(a2Sql).toContain('created_at');
    expect(a2Sql).toContain('task_type');
    expect(Array.isArray(a2Params)).toBe(true);
    expect(a2Params.length).toBeGreaterThanOrEqual(3); // cutoff + exempt types + exempt actions
  });
});
