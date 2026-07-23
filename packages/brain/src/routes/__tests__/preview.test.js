import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAllocatePort = vi.fn();
const mockMarkPreviewInactive = vi.fn();
const mockGetPreview = vi.fn();
const mockStopPreview = vi.fn();
const mockAdmitPreview = vi.fn();
const mockDestroyPreview = vi.fn();

vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../../preview-manager.js', () => ({
  allocatePort: mockAllocatePort,
  markPreviewInactive: mockMarkPreviewInactive,
  markPreviewActive: vi.fn(),
  getPreview: mockGetPreview,
  stopPreview: mockStopPreview,
}));
// 本 sprint 接入：routes/preview.js 唯一调用 admitPreview()/destroyPreview()，
// 不再单独调用无锁的 allocatePreview()（TOCTOU 修复，见合同 Risks #2）。
vi.mock('../../capacity-gate.js', () => ({
  admitPreview: mockAdmitPreview,
}));
vi.mock('../../preview-destroyer.js', () => ({
  destroyPreview: mockDestroyPreview,
}));

// preview.js uses spawn — mock child_process to avoid OS calls in tests
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
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

// ── POST /start ──────────────────────────────────────────────────────────────
describe('POST /start', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns port and db_name on success', async () => {
    mockAdmitPreview.mockResolvedValue({ admitted: true, port: 5300, db_name: 'cecelia_preview_1' });
    const res = await (await getRequest())(await makeApp())
      .post('/start')
      .send({ pr_number: 1, branch_name: 'test-branch', base_repo: 'cecelia' });
    expect(res.status).toBe(200);
    expect(res.body.port).toBe(5300);
    expect(res.body.db_name).toBe('cecelia_preview_1');
    expect(res.body.status).toBe('starting');
  });

  it('returns 400 when missing pr_number', async () => {
    const res = await (await getRequest())(await makeApp())
      .post('/start')
      .send({ branch_name: 'test-branch' });
    expect(res.status).toBe(400);
  });

  it('returns 503 when admission rejected (capacity gate)', async () => {
    mockAdmitPreview.mockResolvedValue({
      admitted: false,
      reason: 'too_many_active',
      free_bytes: 60000000000,
      projected_cost_bytes: 2147483648,
      need_release_bytes: 0,
    });
    const res = await (await getRequest())(await makeApp())
      .post('/start')
      .send({ pr_number: 2, branch_name: 'test-branch' });
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('too_many_active');
    expect(typeof res.body.free_bytes).toBe('number');
    expect(typeof res.body.projected_cost_bytes).toBe('number');
    expect(typeof res.body.need_release_bytes).toBe('number');
  });

  it('returns 500 when admitPreview throws an unexpected error', async () => {
    mockAdmitPreview.mockRejectedValue(new Error('unexpected db error'));
    const res = await (await getRequest())(await makeApp())
      .post('/start')
      .send({ pr_number: 3, branch_name: 'test-branch' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/unexpected/);
  });
});

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

// ── 向后兼容 POST /allocate ───────────────────────────────────────────────────
describe('POST /allocate (deprecated compat)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns port on success', async () => {
    mockAllocatePort.mockResolvedValue(5300);
    const res = await (await getRequest())(await makeApp())
      .post('/allocate')
      .send({ pr_number: 1, branch_name: 'test-branch', base_repo: 'cecelia' });
    expect(res.status).toBe(200);
    expect(res.body.port).toBe(5300);
  });

  it('returns 400 when missing pr_number', async () => {
    const res = await (await getRequest())(await makeApp())
      .post('/allocate')
      .send({ branch_name: 'test-branch' });
    expect(res.status).toBe(400);
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
