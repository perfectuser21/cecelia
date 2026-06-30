import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockQuery = vi.fn();
const mockAllocatePort = vi.fn();
const mockStopPreview = vi.fn();

vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../../preview-manager.js', () => ({
  allocatePort: mockAllocatePort,
  stopPreview: mockStopPreview,
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

describe('POST /allocate', () => {
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

  it('returns 500 when pool exhausted', async () => {
    mockAllocatePort.mockRejectedValue(new Error('preview port pool exhausted'));
    const res = await (await getRequest())(await makeApp())
      .post('/allocate')
      .send({ pr_number: 2, branch_name: 'test-branch' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/exhausted/);
  });
});

describe('GET /', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all preview environments', async () => {
    const fakeRows = [{ id: 'abc', pr_number: 1, port: 5300 }];
    mockQuery.mockResolvedValue({ rows: fakeRows });
    const res = await (await getRequest())(await makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT \* FROM preview_environments/),
    );
  });
});

describe('DELETE /:pr_number', () => {
  beforeEach(() => vi.clearAllMocks());

  it('kills the review process, deletes DB row, and returns stopped:true', async () => {
    // First call: SELECT port; Second call would be from stopPreview (mocked via preview-manager)
    mockQuery.mockResolvedValue({ rows: [{ port: 5300 }] });
    mockStopPreview.mockResolvedValue(undefined);
    const res = await (await getRequest())(await makeApp()).delete('/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stopped: true });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT port FROM preview_environments/),
      [1],
    );
    expect(mockStopPreview).toHaveBeenCalledWith(1);
  });

  it('still succeeds when no DB row found for pr_number', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockStopPreview.mockResolvedValue(undefined);
    const res = await (await getRequest())(await makeApp()).delete('/999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stopped: true });
  });

  it('returns 400 for non-numeric pr_number', async () => {
    const res = await (await getRequest())(await makeApp()).delete('/abc');
    expect(res.status).toBe(400);
  });
});
