import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAllocatePreview = vi.fn();
const mockAllocatePort = vi.fn();
const mockMarkPreviewInactive = vi.fn();
const mockGetPreview = vi.fn();
const mockStopPreview = vi.fn();

vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../../preview-manager.js', () => ({
  allocatePreview: mockAllocatePreview,
  allocatePort: mockAllocatePort,
  markPreviewInactive: mockMarkPreviewInactive,
  markPreviewActive: vi.fn(),
  getPreview: mockGetPreview,
  stopPreview: mockStopPreview,
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
    mockAllocatePreview.mockResolvedValue({ port: 5300, db_name: 'cecelia_preview_1' });
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

  it('returns 500 when pool exhausted', async () => {
    mockAllocatePreview.mockRejectedValue(new Error('preview port pool exhausted'));
    const res = await (await getRequest())(await makeApp())
      .post('/start')
      .send({ pr_number: 2, branch_name: 'test-branch' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/exhausted/);
  });
});

// ── POST /stop/:pr ────────────────────────────────────────────────────────────
describe('POST /stop/:pr_number', () => {
  beforeEach(() => vi.clearAllMocks());

  it('triggers stop and marks inactive', async () => {
    mockGetPreview.mockResolvedValue({ port: 5300, db_name: 'cecelia_preview_1' });
    mockMarkPreviewInactive.mockResolvedValue(undefined);
    const res = await (await getRequest())(await makeApp()).post('/stop/1');
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(true);
    expect(mockMarkPreviewInactive).toHaveBeenCalledWith(1);
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
