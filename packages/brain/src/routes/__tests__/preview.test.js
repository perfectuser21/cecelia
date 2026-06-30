import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../../../db.js', () => ({ default: mockPool }));
vi.mock('../../preview-manager.js', () => ({
  allocatePort: vi.fn(),
  stopPreview: vi.fn(),
}));

const { allocatePort, stopPreview } = await import('../../preview-manager.js');

// 延迟导入路由避免 db mock 未注入
const { default: previewRouter } = await import('../preview.js');
import express from 'express';
import request from 'supertest';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', previewRouter);
  return app;
}

describe('POST /allocate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns port on success', async () => {
    allocatePort.mockResolvedValue(5300);
    const app = makeApp();
    const res = await request(app)
      .post('/allocate')
      .send({ pr_number: 1, branch_name: 'test-branch', base_repo: 'cecelia' });
    expect(res.status).toBe(200);
    expect(res.body.port).toBe(5300);
  });

  it('returns 400 when missing pr_number', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/allocate')
      .send({ branch_name: 'test-branch' });
    expect(res.status).toBe(400);
  });

  it('returns 500 when pool exhausted', async () => {
    allocatePort.mockRejectedValue(new Error('preview port pool exhausted'));
    const app = makeApp();
    const res = await request(app)
      .post('/allocate')
      .send({ pr_number: 2, branch_name: 'test-branch' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/exhausted/);
  });
});

describe('GET /', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns active preview environments', async () => {
    const fakeRows = [{ id: 'abc', pr_number: 1, port: 5300, status: 'active' }];
    mockPool.query.mockResolvedValue({ rows: fakeRows });
    const app = makeApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeRows);
  });
});

describe('DELETE /:pr_number', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stops preview and returns stopped:true', async () => {
    stopPreview.mockResolvedValue(undefined);
    const app = makeApp();
    const res = await request(app).delete('/1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stopped: true });
  });

  it('returns 400 for non-numeric pr_number', async () => {
    const app = makeApp();
    const res = await request(app).delete('/abc');
    expect(res.status).toBe(400);
  });
});
