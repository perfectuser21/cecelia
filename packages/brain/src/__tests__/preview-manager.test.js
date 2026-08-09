import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../db.js', () => ({ default: mockPool }));

const {
  allocatePreview,
  allocatePort,
  stopPreview,
  markPreviewActive,
  markPreviewInactive,
  getPreview,
} = await import('../preview-manager.js');

describe('allocatePreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allocates first free port in 5300-5399 range', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // SELECT existing active for this PR → none
      .mockResolvedValueOnce({ rows: [] })  // SELECT all active ports → empty
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    const result = await allocatePreview(1, 'test-branch', 'cecelia');
    expect(result.port).toBe(5300);
    expect(result.db_name).toBe('cecelia_preview_1');
    expect(mockPool.query).toHaveBeenCalledTimes(3);
  });

  it('returns existing allocation when same PR already has active record (idempotent)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ port: 5342, db_name: 'cecelia_preview_1' }] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [] }); // UPDATE status='starting'
    const result = await allocatePreview(1, 'test-branch', 'cecelia');
    expect(result.port).toBe(5342);
    expect(result.db_name).toBe('cecelia_preview_1');
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('resets status to starting on reuse (regression: PR#3810 CI 实测——重推同一PR时外部轮询看到上一轮遗留的active提前判定就绪，健康检查扑空)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ port: 5342, db_name: 'cecelia_preview_1' }] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    await allocatePreview(1, 'test-branch', 'cecelia');
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[0]).toMatch(/UPDATE preview_environments SET status = 'starting'/);
    expect(updateCall[0]).toMatch(/status != 'inactive'/);
    expect(updateCall[1]).toEqual([1]);
  });

  it('preserves inactive history when reusing the live row for the same PR', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ port: 5342, db_name: 'cecelia_preview_1' }] })
      .mockResolvedValueOnce({ rows: [] });
    await allocatePreview(1, 'test-branch', 'cecelia');
    const updateSql = mockPool.query.mock.calls[1][0];
    expect(updateSql).toMatch(/pr_number = \$1[\s\S]*status != 'inactive'/);
  });

  it('skips used ports', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // SELECT existing → none
      .mockResolvedValueOnce({ rows: [{ port: 5300 }, { port: 5301 }] }) // used ports
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    const result = await allocatePreview(2, 'test-branch', 'cecelia');
    expect(result.port).toBe(5302);
  });

  it('throws when all ports are used', async () => {
    const allPorts = Array.from({ length: 100 }, (_, i) => ({ port: 5300 + i }));
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })       // SELECT existing → none
      .mockResolvedValueOnce({ rows: allPorts }); // all ports used
    await expect(allocatePreview(3, 'test-branch', 'cecelia')).rejects.toThrow('exhausted');
  });
});

describe('allocatePort (deprecated compat)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns port number (wraps allocatePreview)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const port = await allocatePort(1, 'test-branch', 'cecelia');
    expect(port).toBe(5300);
  });
});

describe('stopPreview (deprecated compat)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks preview inactive', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await stopPreview(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE preview_environments SET status = 'inactive'/i),
      [1],
    );
  });
});

describe('markPreviewInactive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates status to inactive', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await markPreviewInactive(5);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE preview_environments SET status = 'inactive'/i),
      [5],
    );
  });
});

describe('live-row status transitions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('markPreviewActive never reactivates inactive history rows', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await markPreviewActive(5);
    expect(mockPool.query.mock.calls[0][0]).toMatch(
      /WHERE pr_number = \$1[\s\S]*status != 'inactive'/,
    );
  });

  it('preview-env-start.sh only activates the current live row', () => {
    const script = readFileSync(resolve(process.cwd(), '../../scripts/preview-env-start.sh'), 'utf8');
    expect(script).toMatch(
      /UPDATE preview_environments SET status='active'[\s\S]*WHERE pr_number=\$\{PR_NUMBER\} AND status<>'inactive'/,
    );
  });

  it('preview-env-start.sh stamps health with the checked-out preview SHA', () => {
    const script = readFileSync(resolve(process.cwd(), '../../scripts/preview-env-start.sh'), 'utf8');
    expect(script).toMatch(/PREVIEW_GIT_SHA=.*git -C "\$WORK_DIR" rev-parse HEAD/);
    expect(script).toMatch(/GIT_SHA="\$PREVIEW_GIT_SHA"/);
  });
});

describe('getPreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the preview row when found', async () => {
    const fake = { id: 'abc', pr_number: 1, port: 5300, status: 'active' };
    mockPool.query.mockResolvedValue({ rows: [fake] });
    const result = await getPreview(1);
    expect(result).toEqual(fake);
  });

  it('returns null when not found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const result = await getPreview(999);
    expect(result).toBeNull();
  });

  it('returns null when rows is empty array (no matching PR)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const result = await getPreview(42);
    expect(result).toBeNull();
  });

  it('db_name follows cecelia_preview_<pr_number> convention', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { db_name } = await allocatePreview(99, 'e2e-verify', 'cecelia');
    expect(db_name).toBe('cecelia_preview_99');
  });
});

// 回归：WS1 预览闸 6 基础设施修复验证（PR#3805-3821）
// 根因：re-push 触发 CI 时旧 preview 残留 active 状态导致外部轮询误判就绪，
// 健康检查扑空（PR#3814）；python3 不在容器 PATH 导致健康检查永远空（PR#3821）；
// 并发 spawn 争抢 WORK_DIR 互相破坏（PR#3821）；worktree 残留注册阻止 add（PR#3821）。
describe('allocatePreview regression: re-push cycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resets active preview to starting when re-pushed (regression: CI 轮询不得看到旧 active)', async () => {
    // 第一次 CI: 分配并标记 active
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ port: 5305, db_name: 'cecelia_preview_7' }] }) // existing
      .mockResolvedValueOnce({ rows: [] }); // UPDATE status='starting'
    const r1 = await allocatePreview(7, 'fix-branch', 'cecelia');
    expect(r1.port).toBe(5305);
    const updateSql = mockPool.query.mock.calls[1][0];
    expect(updateSql).toMatch(/status = 'starting'/);
    expect(mockPool.query.mock.calls[1][1]).toEqual([7]);
  });

  it('allocates port 5300 when no existing record and no ports used', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // no existing
      .mockResolvedValueOnce({ rows: [] })  // no ports in use
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    const r = await allocatePreview(100, 'e2e-v5', 'cecelia');
    expect(r.port).toBe(5300);
    expect(r.db_name).toBe('cecelia_preview_100');
  });
});
