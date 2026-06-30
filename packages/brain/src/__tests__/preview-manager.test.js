import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../db.js', () => ({ default: mockPool }));

const { allocatePort, stopPreview } = await import('../preview-manager.js');

describe('allocatePort', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allocates first free port in 5300-5399 range', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })  // SELECT used ports → empty
      .mockResolvedValueOnce({ rows: [] });  // INSERT
    const port = await allocatePort(1, 'test-branch', 'cecelia');
    expect(port).toBe(5300);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('skips used ports', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ port: 5300 }, { port: 5301 }] })
      .mockResolvedValueOnce({ rows: [] });
    const port = await allocatePort(2, 'test-branch', 'cecelia');
    expect(port).toBe(5302);
  });

  it('throws when all ports are used', async () => {
    const allPorts = Array.from({ length: 100 }, (_, i) => ({ port: 5300 + i }));
    mockPool.query.mockResolvedValueOnce({ rows: allPorts });
    await expect(allocatePort(3, 'test-branch', 'cecelia')).rejects.toThrow('exhausted');
  });
});

describe('stopPreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates status to stopped', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await stopPreview(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("status='stopped'"),
      [1]
    );
  });
});
