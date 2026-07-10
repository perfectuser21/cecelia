import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushMock = vi.fn().mockResolvedValue('atom-1');
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: (...a) => pushMock(...a) }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(undefined) }));

import { raiseBreachAlerts } from '../ledger-hygiene.js';

describe('issue 创建 → capture_atoms 推送（T10）', () => {
  beforeEach(() => pushMock.mockClear());

  it('ledger-hygiene 开 issue 后推送 atom（subtype=priority，来源指向 issues/id）', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT 1 FROM issues/.test(sql)) return { rows: [] };
        if (/INSERT INTO issues/.test(sql)) return { rows: [{ id: 'issue-1' }] };
        return { rows: [] };
      }),
    };
    await raiseBreachAlerts(pool, [{ name: 'm1', prevDebt: 1, debt: 2, streak: 1 }], '2026-07-10');
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [, fields] = pushMock.mock.calls[0];
    expect(fields.targetType).toBe('issue');
    expect(fields.targetSubtype).toBe('P2');
    expect(fields.routedToTable).toBe('issues');
    expect(fields.routedToId).toBe('issue-1');
  });

  it('当日去重命中 → 不 INSERT 也不推送', async () => {
    const pool = { query: vi.fn(async (sql) => (/SELECT 1 FROM issues/.test(sql) ? { rows: [{ 1: 1 }] } : { rows: [] })) };
    await raiseBreachAlerts(pool, [{ name: 'm1', prevDebt: 1, debt: 2, streak: 1 }], '2026-07-10');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
