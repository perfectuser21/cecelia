import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

let app;
const SHA_40 = 'a'.repeat(40);
const OTHER_SHA_40 = 'b'.repeat(40);
const metadata = (repo = 'cecelia') => ({
  repo, scanned_at: new Date(), source_revision: SHA_40, scanner_version: 'api-registry-v2',
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { default: router } = await import('../registry.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain/registry', router);
});

describe('GET /api/brain/registry 照相层改道', () => {
  it('type=api → 查 api_registry,返回 {items,count,freshness} 包装且字段映射正确', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 1, repo: 'cecelia', method: 'GET', path: '/api/brain/context',
        file_path: 'packages/brain/src/routes.js', line_number: 42, area: 'cecelia', description: null,
        scanned_at: new Date(), source_revision: SHA_40, scanner_version: 'api-registry-v2',
      }] })
      .mockResolvedValueOnce({ rows: [metadata()] });
    const res = await request(app).get('/api/brain/registry?type=api');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain('api_registry');
    expect(mockQuery.mock.calls[0][0]).not.toContain('system_registry');
    expect(res.body.items[0].name).toBe('GET /api/brain/context');
    expect(res.body.items[0].location).toBe('packages/brain/src/routes.js:42');
    expect(res.body.items[0]).toMatchObject({
      repo: 'cecelia', source_revision: SHA_40, scanner_version: 'api-registry-v2',
    });
    expect(res.body).toMatchObject({
      repo: 'cecelia', source_revision: SHA_40, scanner_version: 'api-registry-v2',
    });
    expect(res.body.freshness).toMatchObject({ repo: 'cecelia', status: 'fresh', stale: false });
    expect(res.body.count).toBe(1);
  });

  it('type=db_schema → 查 db_schema_registry,name=table_name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 2, table_name: 'tasks', columns: 'id,title,status', area: 'cecelia', scanned_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [metadata()] });
    const res = await request(app).get('/api/brain/registry?type=db_schema');
    expect(mockQuery.mock.calls[0][0]).toContain('db_schema_registry');
    expect(res.body.items[0].name).toBe('tasks');
  });

  it('type=test → 查 test_registry,description 含 test_count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 3, file_path: 'packages/brain/src/__tests__/a.test.js', test_count: 7, test_type: 'unit', status: 'active', area: 'cecelia', scanned_at: new Date() }] })
      .mockResolvedValueOnce({ rows: [metadata()] });
    const res = await request(app).get('/api/brain/registry?type=test');
    expect(mockQuery.mock.calls[0][0]).toContain('test_registry');
    expect(res.body.items[0].description).toContain('7 tests');
  });

  it('照相层空表 → items:[] 且 freshness.stale:true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/brain/registry?type=api');
    expect(res.body.items).toEqual([]);
    expect(res.body.freshness).toMatchObject({ status: 'unknown', reason_code: 'snapshot_missing', stale: true });
  });

  it('search 参数作用于 path/file_path', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [metadata()] });
    await request(app).get('/api/brain/registry?type=api&search=brain');
    expect(mockQuery.mock.calls[0][0]).toContain('ILIKE');
    expect(mockQuery.mock.calls[0][1]).toContain('%brain%');
  });

  it('?repo=other-repo 同时过滤 items/latest metadata 并传播 repo provenance', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 4, repo: 'other-repo', method: 'GET', path: '/other', file_path: 'other.js',
        line_number: 1, area: 'other', description: null, scanned_at: new Date(),
        source_revision: OTHER_SHA_40, scanner_version: 'api-registry-v2',
      }] })
      .mockResolvedValueOnce({ rows: [{
        repo: 'other-repo', scanned_at: new Date(),
        source_revision: OTHER_SHA_40, scanner_version: 'api-registry-v2',
      }] });

    const res = await request(app).get('/api/brain/registry?type=api&repo=other-repo');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain('WHERE repo = $1');
    expect(mockQuery.mock.calls[0][1][0]).toBe('other-repo');
    expect(mockQuery.mock.calls[1][0]).toMatch(/WHERE repo = \$1[\s\S]+ORDER BY scanned_at DESC/);
    expect(mockQuery.mock.calls[1][1]).toEqual(['other-repo']);
    expect(res.body.items[0]).toMatchObject({ repo: 'other-repo', source_revision: OTHER_SHA_40 });
    expect(res.body.freshness).toMatchObject({
      repo: 'other-repo', source_revision: OTHER_SHA_40, scanner_version: 'api-registry-v2',
    });
  });

  it('type=machine 仍走 system_registry 裸数组(其余 type 行为不变)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, name: 'us-m4', type: 'machine', status: 'active' }] });
    const res = await request(app).get('/api/brain/registry?type=machine');
    expect(mockQuery.mock.calls[0][0]).toContain('system_registry');
    expect(Array.isArray(res.body)).toBe(true);
  });
});
