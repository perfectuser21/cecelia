/**
 * TDD: MJ5 刀4 S4 保鲜对账（nightly）
 *
 * BEHAVIOR 覆盖（10 条）:
 *  [S4-N1]  不在时间窗口 → skipped
 *  [S4-N2]  已运行当日 → skipped（哨兵去重）
 *  [S4-N3]  带锚 PR 昨日 merge，格子已回写 green → A1 pass
 *  [S4-N4]  带锚 PR 昨日 merge，格子未回写 → A1 fail + Bark
 *  [S4-N5]  昨日无锚 merge PR = 0 → A2 pass
 *  [S4-N6]  昨日有无锚 merge PR → A2 fail + Bark
 *  [S4-N7]  所有断言通过 → 写 sentinel，返回 failures=0
 *  [S4-N8]  三闸心跳——闸文件存在 → A4 pass
 *  [S4-N9]  A3 base_ref 格子 feature_id 为空 → A3 fail（纸门修复验证）
 *  [S4-N10] A2 豁免：SQL 含 cutoff 参数 + NOT IN 豁免类型列表
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

// helper: make a pool whose query() returns the given values in order
function makePool(...returnValues) {
  const fn = vi.fn();
  for (const rv of returnValues) fn.mockResolvedValueOnce(rv);
  return { query: fn };
}

// standard "all-ok" stubs for A2 / A3.1 / A3.2
const OK_A2   = { rows: [{ count: '0' }] };
const OK_A3_1 = { rows: [{ count: '0' }] }; // brokenBaseRefCount = 0
const OK_A3_2 = { rows: [] };               // no steps without promise

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
    const result = await runPromiseMapNightly(now);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('outside_window');
  });
});

// ── [S4-N2] 哨兵去重 ─────────────────────────────────────
describe('[S4-N2] 哨兵已存在（当日已跑）', () => {
  it('returns skipped when sentinel is recent', async () => {
    const now = new Date(`2026-07-18T${String(NIGHTLY_HOUR_UTC).padStart(2, '0')}:00:00Z`);
    const recentTs = new Date(now.getTime() - 1000 * 60 * 30).toISOString();
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
    const pool = makePool(
      { rows: [{ task_id: 'tid1', step_id: 'sid1', pr_url: 'http://gh/1' }] }, // A1 anchored
      { rows: [{ count: '1' }] }, // A1 cell check: 1 green
      OK_A2, OK_A3_1, OK_A3_2,
    );
    const assertions = await buildNightlyAssertions(pool);
    const a1 = assertions.find(a => a.key === 'anchor_cell_writeback');
    expect(a1.ok).toBe(true);
    expect(a1.detail).toMatch(/1.*带锚/);
  });
});

describe('[S4-N4] A1 格子未回写 → fail', () => {
  it('A1 fails when anchored PR has no green cell', async () => {
    const pool = makePool(
      { rows: [{ task_id: 'tid1', step_id: 'sid1', pr_url: 'http://gh/1' }] },
      { rows: [{ count: '0' }] }, // no green cell
      OK_A2, OK_A3_1, OK_A3_2,
    );
    const assertions = await buildNightlyAssertions(pool);
    const a1 = assertions.find(a => a.key === 'anchor_cell_writeback');
    expect(a1.ok).toBe(false);
    expect(a1.detail).toMatch(/未回写/);
  });
});

describe('[S4-N5] A2 无锚 merge PR = 0 → pass', () => {
  it('A2 passes when no unanchored merges yesterday', async () => {
    const pool = makePool({ rows: [] }, OK_A2, OK_A3_1, OK_A3_2);
    const assertions = await buildNightlyAssertions(pool);
    const a2 = assertions.find(a => a.key === 'zero_unanchored_merges');
    expect(a2.ok).toBe(true);
  });
});

describe('[S4-N6] A2 有无锚 merge PR → fail', () => {
  it('A2 fails when unanchored non-exempt post-cutoff merges exist', async () => {
    const pool = makePool(
      { rows: [] },
      { rows: [{ count: '2' }] }, // 2 unanchored (non-exempt, post-cutoff)
      OK_A3_1, OK_A3_2,
    );
    const assertions = await buildNightlyAssertions(pool);
    const a2 = assertions.find(a => a.key === 'zero_unanchored_merges');
    expect(a2.ok).toBe(false);
    expect(a2.detail).toMatch(/2/);
    expect(a2.detail).toMatch(/豁免期/);
  });
});

describe('[S4-N7] 全部通过 → sentinel 写入，返回 failures=0', () => {
  it('writes sentinel and returns 0 failures when all pass', async () => {
    const now = new Date(`2026-07-18T${String(NIGHTLY_HOUR_UTC).padStart(2, '0')}:00:00Z`);
    mockQuery
      .mockResolvedValueOnce({ rows: [] })               // sentinel read: not found
      .mockResolvedValueOnce({ rows: [] })               // A1: no anchored PRs
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // A2: 0 unanchored
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // A3.1: brokenBaseRefCount=0
      .mockResolvedValueOnce({ rows: [] })               // A3.2: no steps without promise
      .mockResolvedValueOnce({ rows: [] });              // sentinel write

    const result = await runPromiseMapNightly(now);
    expect(result.ran).toBe(true);
    expect(result.failures).toBe(0);
    expect(mockSendBark).not.toHaveBeenCalled();
    const sentinelWrite = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO working_memory'),
    );
    expect(sentinelWrite).toBeTruthy();
  });
});

describe('[S4-N8] A4 三闸心跳——闸文件存在', () => {
  it('A4 passes when gate files exist', async () => {
    const pool = makePool({ rows: [] }, OK_A2, OK_A3_1, OK_A3_2);
    existsSync.mockReturnValue(true);
    const assertions = await buildNightlyAssertions(pool);
    const a4 = assertions.find(a => a.key === 'gate_heartbeat');
    expect(a4.ok).toBe(true);
    expect(a4.detail).toMatch(/3.*闸/);
  });

  it('A4 fails when a gate file is missing', async () => {
    const pool = makePool({ rows: [] }, OK_A2, OK_A3_1, OK_A3_2);
    existsSync.mockReturnValue(false);
    const assertions = await buildNightlyAssertions(pool);
    const a4 = assertions.find(a => a.key === 'gate_heartbeat');
    expect(a4.ok).toBe(false);
    expect(a4.detail).toMatch(/缺失/);
  });
});

// ── [S4-N9] A3 纸门修复——base_ref 断线检测 ──────────────
describe('[S4-N9] A3 base_ref 断线 → fail（纸门修复验证）', () => {
  it('A3 fails when base_ref cells have NULL feature_id', async () => {
    const pool = makePool(
      { rows: [] },
      OK_A2,
      { rows: [{ count: '3' }] }, // 3 broken base_ref cells
      OK_A3_2,
    );
    const assertions = await buildNightlyAssertions(pool);
    const a3 = assertions.find(a => a.key === 'ledger_integrity');
    expect(a3.ok).toBe(false);
    expect(a3.detail).toMatch(/3.*base_ref.*断线/);
  });

  it('A3 passes when all base_ref cells have feature_id', async () => {
    const pool = makePool({ rows: [] }, OK_A2, OK_A3_1, OK_A3_2);
    const assertions = await buildNightlyAssertions(pool);
    const a3 = assertions.find(a => a.key === 'ledger_integrity');
    expect(a3.ok).toBe(true);
    expect(a3.detail).toMatch(/完整/);
  });
});

// ── [S4-N10] A2 豁免对齐 ─────────────────────────────────
describe('[S4-N10] A2 豁免对齐——SQL 含 cutoff + 豁免类型', () => {
  it('A2 query 参数 $1 为 ANCHOR_LEGACY_CUTOFF ISO 字符串', async () => {
    const pool = makePool({ rows: [] }, OK_A2, OK_A3_1, OK_A3_2);
    await buildNightlyAssertions(pool);
    const a2Call = pool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('dev_records') && sql.includes('created_at'),
    );
    expect(a2Call).toBeTruthy();
    expect(a2Call[1][0]).toMatch(/2026-07-17/);
  });

  it('A2 query 参数列表包含豁免 task_type（超过 2 个参数）', async () => {
    const pool = makePool({ rows: [] }, OK_A2, OK_A3_1, OK_A3_2);
    await buildNightlyAssertions(pool);
    const a2Call = pool.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('dev_records') && sql.includes('NOT IN'),
    );
    expect(a2Call).toBeTruthy();
    expect(a2Call[1].length).toBeGreaterThan(2);
  });
});
