import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../db.js', () => ({ default: mockPool }));

const { allocatePreview, allocatePort, stopPreview, markPreviewInactive, getPreview } = await import('../preview-manager.js');

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
    expect(updateCall[1]).toEqual([1]);
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
