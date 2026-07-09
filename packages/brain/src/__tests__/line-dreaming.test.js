import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  isInLineDreamingWindow,
  alreadyDreamedToday,
  getActiveJourneys,
} from '../line-dreaming.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isInLineDreamingWindow — UTC 21:00-21:05 = 北京 05:00-05:05', () => {
  it('UTC 20:59 → false', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 20, 59)))).toBe(false);
  });
  it('UTC 21:00 → true', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 0)))).toBe(true);
  });
  it('UTC 21:04 → true', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 4)))).toBe(true);
  });
  it('UTC 21:05 → false', () => {
    expect(isInLineDreamingWindow(new Date(Date.UTC(2026, 6, 10, 21, 5)))).toBe(false);
  });
});

describe('alreadyDreamedToday — 20h 内该 journey 已有 line_ledger → true', () => {
  it('有记录 → true，SQL 含 line_ledger/20 hours/journey_id', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) };
    await expect(alreadyDreamedToday(pool, 'journey-1')).resolves.toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/line_ledger/);
    expect(sql).toMatch(/20 hours/);
    expect(sql).toMatch(/journey_id/);
    expect(params).toEqual(['journey-1']);
  });
  it('无记录 → false', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(alreadyDreamedToday(pool, 'journey-1')).resolves.toBe(false);
  });
});

describe('getActiveJourneys — 拉 status=active 的 journey', () => {
  it('返回 id+name 列表', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }],
      }),
    };
    const result = await getActiveJourneys(pool);
    expect(result).toEqual([{ id: 'j1', name: 'Line A' }, { id: 'j2', name: 'Line B' }]);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toMatch(/status\s*=\s*'active'/);
  });
});
