import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushMock = vi.fn().mockResolvedValue('atom-1');
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: (...a) => pushMock(...a) }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { raiseBreachAlerts } from '../ledger-hygiene.js';
import { runTestLifecyclePatrol } from '../test-lifecycle-patrol.js';

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

  const ORPHAN_ROW = { id: 'reg-1', file_path: 'src/__tests__/dead.test.js', status: 'active', feature_id: 'f1', scanned_at: new Date().toISOString() };

  function makePatrolDb({ issueInsertFails = false } = {}) {
    return {
      query: vi.fn(async (sql) => {
        if (/FROM test_registry/.test(sql)) return { rows: [ORPHAN_ROW] };
        if (/SELECT id FROM journey_features/.test(sql)) return { rows: [] }; // feature 已删 → 孤儿
        if (/INSERT INTO test_lifecycle_alerts/.test(sql)) return { rows: [{ id: 'alert-1' }] };
        if (/INSERT INTO issues/.test(sql)) {
          if (issueInsertFails) throw new Error('insert boom');
          return { rows: [{ id: 'issue-2' }] };
        }
        return { rows: [] };
      }),
    };
  }

  it('test-lifecycle-patrol 孤儿 issue 落库后推送 atom（subtype=P2，来源指向 issues/id）', async () => {
    const db = makePatrolDb();
    await runTestLifecyclePatrol(db);
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [, fields] = pushMock.mock.calls[0];
    expect(fields.targetType).toBe('issue');
    expect(fields.targetSubtype).toBe('P2');
    expect(fields.routedToTable).toBe('issues');
    expect(fields.routedToId).toBe('issue-2');
  });

  it('test-lifecycle-patrol issue INSERT 失败（吞错返回空 rows）→ 不推送也不抛', async () => {
    const db = makePatrolDb({ issueInsertFails: true });
    await expect(runTestLifecyclePatrol(db)).resolves.toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
