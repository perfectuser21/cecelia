import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import { existsSync } from 'fs';
import { raise } from '../../alerting.js';
import { runTestLifecyclePatrol } from '../../test-lifecycle-patrol.js';

describe('E2E fixture: 删掉一个 journey_features + 它的 test → 巡检标 orphan', () => {
  it('journey_features 行已删、test 文件仍在磁盘 → test_registry 该行 status=orphan, orphan_reason=feature_deleted, issues 表有新记录', async () => {
    // fixture: 模拟一张已存在但对应能力(feature_id='...123')已被删除的 test 行
    const FEATURE_ID = 'a1b2c3d4-0000-0000-0000-000000000123';
    const testRegistryRow = {
      id: 10,
      file_path: 'packages/brain/src/__tests__/deleted-feature.test.js',
      status: 'active',
      feature_id: FEATURE_ID,
      scanned_at: new Date(),
    };

    const state = { registryRow: { ...testRegistryRow }, issues: [], alerts: [] };
    existsSync.mockReturnValue(true); // test 文件本身还在磁盘

    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
          return { rows: [state.registryRow] };
        }
        if (sql.includes('SELECT id FROM journey_features WHERE id = ANY')) {
          return { rows: [] }; // feature_id=FEATURE_ID 查无此能力 → 已删
        }
        if (sql.includes('UPDATE test_registry')) {
          state.registryRow.status = 'orphan';
          state.registryRow.orphan_reason = params[0];
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO test_lifecycle_alerts')) {
          state.alerts.push({ file_path: params[0], orphan_reason: params[1], feature_id: params[2] });
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO issues')) {
          state.issues.push({ title: params[0], body: params[1] });
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await runTestLifecyclePatrol(pool);

    expect(state.registryRow.status).toBe('orphan');
    expect(state.registryRow.orphan_reason).toBe('feature_deleted');
    expect(state.issues).toHaveLength(1);
    expect(state.issues[0].title).toContain('deleted-feature.test.js');
    expect(state.alerts).toHaveLength(1);
    expect(raise).toHaveBeenCalledWith('P2', 'test_lifecycle_orphan_feature_deleted', expect.stringContaining(FEATURE_ID));
  });

  it('对比：磁盘文件已删的行走 file_missing 路径，直接删行，不建 issue', async () => {
    const state = { deletedIds: [], issues: [] };
    existsSync.mockReturnValue(false); // 文件不在磁盘

    const pool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes('SELECT id, file_path, status, feature_id, scanned_at FROM test_registry')) {
          return { rows: [{ id: 11, file_path: 'packages/brain/src/__tests__/gone.test.js', status: 'active', feature_id: null, scanned_at: new Date() }] };
        }
        if (sql.includes('DELETE FROM test_registry')) {
          state.deletedIds.push(params[0]);
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO issues')) {
          state.issues.push(params);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await runTestLifecyclePatrol(pool);

    expect(state.deletedIds).toEqual([11]);
    expect(state.issues).toHaveLength(0); // file_missing 零风险自动收敛，不建 issue
  });
});
