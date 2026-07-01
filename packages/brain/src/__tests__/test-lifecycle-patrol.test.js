import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import { existsSync } from 'fs';
import { raise } from '../alerting.js';
import { runTestLifecyclePatrol, isInPatrolWindow, PATROL_HOUR_UTC, PATROL_WINDOW_MINUTES } from '../test-lifecycle-patrol.js';

function makePool(rows) {
  const calls = [];
  return {
    calls,
    query: vi.fn().mockImplementation(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
        return { rows };
      }
      if (sql.includes('SELECT id FROM journey_features WHERE id = ANY')) {
        return { rows: [] }; // 默认：查到的 feature_id 全部不存在（能力已删）
      }
      if (sql.includes('INSERT INTO test_lifecycle_alerts')) {
        return { rows: [{ id: 1 }] }; // 默认：今天首次插入成功
      }
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runTestLifecyclePatrol — file_missing', () => {
  it('磁盘文件已删 → 物理删该 registry 行', async () => {
    const pool = makePool([
      { id: 1, file_path: 'packages/brain/src/gone.test.js', status: 'active', feature_id: null, scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(false);

    await runTestLifecyclePatrol(pool);

    const del = pool.calls.find(c => c.sql.includes('DELETE FROM test_registry'));
    expect(del).toBeTruthy();
    expect(del.params).toEqual([1]);
  });
});

describe('runTestLifecyclePatrol — feature_deleted', () => {
  it('文件存在但关联能力已删 → 标 orphan + raise + 建 issue，不删行', async () => {
    const pool = makePool([
      { id: 2, file_path: 'packages/brain/src/still-here.test.js', status: 'active', feature_id: 'a1b2c3d4-0000-0000-0000-000000000099', scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true); // 文件还在

    await runTestLifecyclePatrol(pool);

    const upd = pool.calls.find(c => c.sql.includes('UPDATE test_registry') && c.sql.includes('orphan'));
    expect(upd).toBeTruthy();
    expect(upd.params).toEqual(expect.arrayContaining(['feature_deleted', 2]));

    const del = pool.calls.find(c => c.sql.includes('DELETE FROM test_registry'));
    expect(del).toBeFalsy(); // 不删文件/行

    expect(raise).toHaveBeenCalledWith('P2', 'test_lifecycle_orphan_feature_deleted', expect.stringContaining('still-here.test.js'));

    const issueInsert = pool.calls.find(c => c.sql.includes('INSERT INTO issues'));
    expect(issueInsert).toBeTruthy();

    const alertInsert = pool.calls.find(c => c.sql.includes('INSERT INTO test_lifecycle_alerts'));
    expect(alertInsert).toBeTruthy();
  });

  it('feature_id 为 NULL → 不判 feature_deleted（防误标）', async () => {
    const pool = makePool([
      { id: 3, file_path: 'packages/brain/src/no-link.test.js', status: 'active', feature_id: null, scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true);

    await runTestLifecyclePatrol(pool);

    const upd = pool.calls.find(c => c.sql.includes('UPDATE test_registry'));
    expect(upd).toBeFalsy();
    expect(raise).not.toHaveBeenCalled();
  });

  it('同一天内第二次巡检命中同一 feature_deleted 行 → 不重复 raise/建issue（去重生效）', async () => {
    const pool = makePool([
      { id: 20, file_path: 'packages/brain/src/dup-orphan.test.js', status: 'active', feature_id: 'a1b2c3d4-0000-0000-0000-000000000201', scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true);
    // 模拟 test_lifecycle_alerts 的 ON CONFLICT DO NOTHING RETURNING id：今天已经插过一次，这次返回空行
    pool.query.mockImplementation(async (sql, params) => {
      pool.calls.push({ sql, params });
      if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
        return { rows: [{ id: 20, file_path: 'packages/brain/src/dup-orphan.test.js', status: 'active', feature_id: 'a1b2c3d4-0000-0000-0000-000000000201', scanned_at: new Date() }] };
      }
      if (sql.includes('SELECT id FROM journey_features WHERE id = ANY')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO test_lifecycle_alerts')) {
        return { rows: [] }; // 已存在同 file_path+patrol_date，DO NOTHING 未插入新行
      }
      return { rows: [] };
    });

    await runTestLifecyclePatrol(pool);

    // UPDATE test_registry 仍然执行（幂等更新时间戳没问题）
    const upd = pool.calls.find(c => c.sql.includes('UPDATE test_registry') && c.sql.includes('orphan'));
    expect(upd).toBeTruthy();

    // 但不应该再次 raise 或建 issue（今天已经处理过）
    expect(raise).not.toHaveBeenCalled();
    const issueInsert = pool.calls.find(c => c.sql.includes('INSERT INTO issues'));
    expect(issueInsert).toBeFalsy();
  });
});

describe('runTestLifecyclePatrol — stale_scan', () => {
  it('scanned_at 超30天且文件仍在 → 汇总弱告警，不改 status', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const pool = makePool([
      { id: 4, file_path: 'packages/brain/src/stale.test.js', status: 'active', feature_id: null, scanned_at: old },
    ]);
    existsSync.mockReturnValue(true);

    const result = await runTestLifecyclePatrol(pool);

    expect(result.staleAlerts).toHaveLength(1);
    expect(result.staleAlerts[0].file_path).toBe('packages/brain/src/stale.test.js');

    const upd = pool.calls.find(c => c.sql.includes('UPDATE test_registry'));
    expect(upd).toBeFalsy();
  });
});

describe('runTestLifecyclePatrol — 自愈复位', () => {
  it('此前 orphan 的行，本轮 file 存在且 feature 存活 → 复位 active', async () => {
    const pool = makePool([
      { id: 5, file_path: 'packages/brain/src/recovered.test.js', status: 'orphan', feature_id: 'a1b2c3d4-0000-0000-0000-000000000042', scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true);
    pool.query.mockImplementation(async (sql, params) => {
      pool.calls.push({ sql, params });
      if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
        return { rows: [{ id: 5, file_path: 'packages/brain/src/recovered.test.js', status: 'orphan', feature_id: 'a1b2c3d4-0000-0000-0000-000000000042', scanned_at: new Date() }] };
      }
      if (sql.includes('SELECT id FROM journey_features WHERE id = ANY')) {
        return { rows: [{ id: 'a1b2c3d4-0000-0000-0000-000000000042' }] }; // feature 复活了
      }
      return { rows: [] };
    });

    await runTestLifecyclePatrol(pool);

    const reset = pool.calls.find(c => c.sql.includes('UPDATE test_registry') && c.sql.includes("status = 'active'"));
    expect(reset).toBeTruthy();
    expect(reset.params).toEqual([5]);
  });
});

describe('runTestLifecyclePatrol — 24h/同日去重', () => {
  it('同一 file_path 同一天 ON CONFLICT DO NOTHING 生效（SQL 层去重，非应用层重复插入）', async () => {
    const pool = makePool([
      { id: 6, file_path: 'packages/brain/src/dup.test.js', status: 'active', feature_id: 'a1b2c3d4-0000-0000-0000-000000000007', scanned_at: new Date() },
    ]);
    existsSync.mockReturnValue(true);

    await runTestLifecyclePatrol(pool);

    const alertInsert = pool.calls.find(c => c.sql.includes('INSERT INTO test_lifecycle_alerts'));
    expect(alertInsert.sql).toContain('ON CONFLICT (file_path, patrol_date) DO NOTHING');
  });
});
