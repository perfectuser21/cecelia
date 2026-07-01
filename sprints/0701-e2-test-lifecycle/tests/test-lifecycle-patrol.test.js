/**
 * test-lifecycle-patrol.test.js — TDD Red 阶段（被测模块尚未存在）
 *
 * 覆盖：
 *   - file_missing 判定 → status='orphan'
 *   - feature_deleted 判定 → 只记录不删
 *   - feature_id IS NULL → 不判 feature_deleted
 *   - 自愈：文件回来 → status='active'
 *   - DB 错误 → patrol 静默跳过（不抛异常）
 *   - 24h 窗口：isInLifecyclePatrolWindow 逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query: mockQuery } }));

// fs.access mock
vi.mock('fs/promises', () => ({
  access: vi.fn(),
}));

import { access } from 'fs/promises';

const { runTestLifecyclePatrol, isInLifecyclePatrolWindow } =
  await import('../../../packages/brain/src/test-lifecycle-patrol.js');

const ROW_ACTIVE = {
  id: 'row-1',
  file_path: '/real/path/foo.test.ts',
  feature_id: null,
  status: 'active',
  orphan_reason: null,
};

const ROW_FILE_MISSING = {
  id: 'row-2',
  file_path: '/nonexistent/path/bar.test.ts',
  feature_id: null,
  status: 'active',
  orphan_reason: null,
};

const ROW_FEAT_DEPRECATED = {
  id: 'row-3',
  file_path: '/real/path/baz.test.ts',
  feature_id: 'feat-uuid-1',
  status: 'active',
  orphan_reason: null,
};

const ROW_FEAT_NULL = {
  id: 'row-4',
  file_path: '/real/path/qux.test.ts',
  feature_id: null,
  status: 'active',
  orphan_reason: null,
};

const ROW_ORPHAN_REVIVE = {
  id: 'row-5',
  file_path: '/real/path/revive.test.ts',
  feature_id: null,
  status: 'orphan',
  orphan_reason: 'file_missing',
};

function setupMocks({ rows = [], featureRows = {}, missingPaths = [] } = {}) {
  access.mockImplementation(async (p) => {
    if (missingPaths.includes(p)) throw new Error('ENOENT');
  });

  mockQuery.mockImplementation(async (sql) => {
    if (sql.includes('SELECT') && sql.includes('test_registry') && !sql.includes('UPDATE')) {
      // 主扫描 OR 窗口检查
      if (sql.includes('MAX(lifecycle_checked_at)')) {
        return { rows: [{ last_checked: null }] }; // 从未运行过 → 应运行
      }
      return { rows };
    }
    if (sql.includes('journey_features') && sql.includes('SELECT')) {
      // 查关联能力状态
      const idMatch = sql.match(/'([^']+)'/);
      const id = idMatch?.[1];
      const feat = featureRows[id];
      return { rows: feat ? [feat] : [] };
    }
    if (sql.includes('UPDATE') && sql.includes('test_registry')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  access.mockReset();
});

describe('file_missing 判定', () => {
  it('file_path 不存在时 UPDATE status=orphan orphan_reason=file_missing', async () => {
    setupMocks({
      rows: [ROW_FILE_MISSING],
      missingPaths: [ROW_FILE_MISSING.file_path],
    });

    await runTestLifecyclePatrol({ force: true });

    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE') && sql.includes("'orphan'") && sql.includes("'file_missing'")
    );
    expect(updateCall).toBeTruthy();
  });

  it('file_path 存在时不标 orphan', async () => {
    setupMocks({
      rows: [ROW_ACTIVE],
      missingPaths: [],
    });

    await runTestLifecyclePatrol({ force: true });

    const orphanCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE') && sql.includes("'orphan'")
    );
    expect(orphanCall).toBeUndefined();
  });
});

describe('feature_deleted 判定', () => {
  it('feature_id 非 NULL 且关联 feature status=deprecated → featureDeletedList 含该行', async () => {
    setupMocks({
      rows: [ROW_FEAT_DEPRECATED],
      missingPaths: [],
      featureRows: { 'feat-uuid-1': { id: 'feat-uuid-1', status: 'deprecated' } },
    });

    const result = await runTestLifecyclePatrol({ force: true });

    expect(result.featureDeletedList).toBeDefined();
    expect(result.featureDeletedList.length).toBeGreaterThanOrEqual(1);
    expect(result.featureDeletedList[0].id).toBe('row-3');
  });

  it('feature_deleted 场景不 DELETE test_registry 行（只记录）', async () => {
    setupMocks({
      rows: [ROW_FEAT_DEPRECATED],
      missingPaths: [],
      featureRows: { 'feat-uuid-1': { id: 'feat-uuid-1', status: 'deprecated' } },
    });

    await runTestLifecyclePatrol({ force: true });

    const deleteCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('DELETE') && sql.includes('test_registry')
    );
    expect(deleteCall).toBeUndefined();
  });
});

describe('feature_id IS NULL → 防误标', () => {
  it('feature_id=NULL 行不出现在 featureDeletedList', async () => {
    setupMocks({
      rows: [ROW_FEAT_NULL],
      missingPaths: [],
    });

    const result = await runTestLifecyclePatrol({ force: true });

    const badEntry = (result.featureDeletedList || []).find((x) => x.id === 'row-4');
    expect(badEntry).toBeUndefined();
  });
});

describe('file_missing 优先于 feature_deleted', () => {
  it('同一行 file_missing + feature deprecated → 以 file_missing 为准', async () => {
    const ROW_BOTH = {
      id: 'row-6',
      file_path: '/missing/both.test.ts',
      feature_id: 'feat-uuid-2',
      status: 'active',
      orphan_reason: null,
    };
    setupMocks({
      rows: [ROW_BOTH],
      missingPaths: [ROW_BOTH.file_path],
      featureRows: { 'feat-uuid-2': { id: 'feat-uuid-2', status: 'deprecated' } },
    });

    const result = await runTestLifecyclePatrol({ force: true });

    // 行应标 orphan=file_missing，不应进 featureDeletedList
    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE') && sql.includes("'orphan'") && sql.includes("'file_missing'")
    );
    expect(updateCall).toBeTruthy();

    const featDeletedEntry = (result.featureDeletedList || []).find((x) => x.id === 'row-6');
    expect(featDeletedEntry).toBeUndefined();
  });
});

describe('自愈：文件回来 → status=active', () => {
  it('orphan 行文件重新存在 → UPDATE status=active orphan_reason=NULL', async () => {
    setupMocks({
      rows: [ROW_ORPHAN_REVIVE],
      missingPaths: [],
    });

    await runTestLifecyclePatrol({ force: true });

    const healCall = mockQuery.mock.calls.find(
      ([sql]) => sql.includes('UPDATE') && sql.includes("'active'") && sql.includes("orphan_reason")
    );
    expect(healCall).toBeTruthy();
  });
});

describe('DB 错误场景（接缝）', () => {
  it('journey_features 查询抛出异常 → patrol 不抛出，返回 skipped 标记', async () => {
    // db_error / query failed — 覆盖 DoD BEHAVIOR 6 的接缝
    access.mockResolvedValue(undefined);
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('MAX(lifecycle_checked_at)')) return { rows: [{ last_checked: null }] };
      if (sql.includes('test_registry') && !sql.includes('UPDATE')) return { rows: [ROW_FEAT_DEPRECATED] };
      if (sql.includes('journey_features')) throw new Error('query failed: connection refused');
      return { rows: [], rowCount: 0 };
    });

    const result = await expect(runTestLifecyclePatrol({ force: true })).resolves.toBeDefined();
    // patrol 不抛异常（resolves 即合格），可选返回 { skipped: true }
  });

  it('test_registry 主查询失败 → patrol 静默返回而非 throw', async () => {
    mockQuery.mockRejectedValue(new Error('dbError: test_registry unreachable'));

    await expect(runTestLifecyclePatrol({ force: true })).resolves.toBeDefined();
  });
});

describe('isInLifecyclePatrolWindow 24h 窗口', () => {
  it('无历史运行记录（last_checked=null） → 应运行（返回 true）', async () => {
    mockQuery.mockResolvedValue({ rows: [{ last_checked: null }] });

    const shouldRun = await isInLifecyclePatrolWindow();
    expect(shouldRun).toBe(true);
  });

  it('last_checked 在 1h 前 → 不应运行（返回 false）', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValue({ rows: [{ last_checked: oneHourAgo }] });

    const shouldRun = await isInLifecyclePatrolWindow();
    expect(shouldRun).toBe(false);
  });

  it('last_checked 在 25h 前 → 应运行（返回 true）', async () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValue({ rows: [{ last_checked: twentyFiveHoursAgo }] });

    const shouldRun = await isInLifecyclePatrolWindow();
    expect(shouldRun).toBe(true);
  });
});
