import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAllocatePort = vi.fn();
const mockMarkPreviewInactive = vi.fn();
const mockGetPreview = vi.fn();
const mockStopPreview = vi.fn();
const mockDestroyPreview = vi.fn();
const mockSpawn = vi.fn(() => ({unref: vi.fn()}));

vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../../preview-manager.js', () => ({
  allocatePort: mockAllocatePort,
  markPreviewInactive: mockMarkPreviewInactive,
  markPreviewActive: vi.fn(),
  getPreview: mockGetPreview,
  stopPreview: mockStopPreview,
}));
vi.mock('../../preview-destroyer.js', () => ({
  destroyPreview: mockDestroyPreview,
}));

// preview.js uses spawn — mock child_process to avoid OS calls in tests
vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

async function makeApp() {
  const { default: router } = await import('../preview.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

const getRequest = async () => (await import('supertest')).default;

// ── POST /stop/:pr ────────────────────────────────────────────────────────────
describe('POST /stop/:pr_number', () => {
  beforeEach(() => vi.clearAllMocks());

  it('triggers destroyPreview and transparently returns its terminal status', async () => {
    mockGetPreview.mockResolvedValue({ port: 5300, db_name: 'cecelia_preview_1' });
    mockDestroyPreview.mockResolvedValue({ destroyed: true, status: 'inactive' });
    const res = await (await getRequest())(await makeApp()).post('/stop/1');
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(true);
    expect(res.body.status).toBe('inactive');
    expect(res.body.cleanup_detail).toBeNull();
    expect(mockDestroyPreview).toHaveBeenCalledWith(1, 'api', expect.any(String), expect.anything());
  });

  it('returns cleanup_failed with cleanup_detail when destroyPreview fails to fully clean up', async () => {
    mockGetPreview.mockResolvedValue({ port: 5300, db_name: 'cecelia_preview_1' });
    const detail = { db_dropped: false, worktree_removed: true, processes_killed: true, temp_files_cleared: true, residual: ['invalid_db_name'] };
    mockDestroyPreview.mockResolvedValue({ destroyed: false, status: 'cleanup_failed', cleanup_detail: detail });
    const res = await (await getRequest())(await makeApp()).post('/stop/1');
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(false);
    expect(res.body.status).toBe('cleanup_failed');
    expect(res.body.cleanup_detail).toEqual(detail);
  });

  it('returns stopped:true with note when no active preview found', async () => {
    mockGetPreview.mockResolvedValue(null);
    const res = await (await getRequest())(await makeApp()).post('/stop/999');
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(true);
    expect(res.body.note).toMatch(/no active preview/);
  });

  it('returns 400 for non-numeric pr_number', async () => {
    const res = await (await getRequest())(await makeApp()).post('/stop/abc');
    expect(res.status).toBe(400);
  });
});

// ── GET /status/:pr ───────────────────────────────────────────────────────────
describe('GET /status/:pr_number', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns preview record when found', async () => {
    const fake = { id: 'abc', pr_number: 1, port: 5300, status: 'active' };
    mockGetPreview.mockResolvedValue(fake);
    const res = await (await getRequest())(await makeApp()).get('/status/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fake);
  });

  it('returns 404 when not found', async () => {
    mockGetPreview.mockResolvedValue(null);
    const res = await (await getRequest())(await makeApp()).get('/status/999');
    expect(res.status).toBe(404);
  });
});

// ── GET / ─────────────────────────────────────────────────────────────────────
describe('GET /', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns active preview environments', async () => {
    const fakeRows = [{ id: 'abc', pr_number: 1, port: 5300, status: 'active' }];
    mockQuery.mockResolvedValue({ rows: fakeRows });
    const res = await (await getRequest())(await makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT \* FROM preview_environments/),
    );
  });
});

// ── 向后兼容 DELETE /:pr_number ──────────────────────────────────────────────
describe('DELETE /:pr_number (deprecated compat)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stops preview and returns stopped:true', async () => {
    mockGetPreview.mockResolvedValue({ port: 5300, db_name: 'cecelia_preview_1' });
    mockMarkPreviewInactive.mockResolvedValue(undefined);
    const res = await (await getRequest())(await makeApp()).delete('/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stopped: true });
    expect(mockMarkPreviewInactive).toHaveBeenCalledWith(1);
    expect(mockSpawn).toHaveBeenCalledWith('bash', [expect.stringMatching(/preview-env-stop\.sh$/), '1', '5300', 'cecelia_preview_1'], expect.objectContaining({detached: true}));
  });

  it('returns stopped:true when no row found', async () => {
    mockGetPreview.mockResolvedValue(null);
    const res = await (await getRequest())(await makeApp()).delete('/999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stopped: true });
  });

  it('returns 400 for non-numeric pr_number', async () => {
    const res = await (await getRequest())(await makeApp()).delete('/abc');
    expect(res.status).toBe(400);
  });
});
