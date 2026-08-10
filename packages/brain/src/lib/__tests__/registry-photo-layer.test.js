import { describe, it, expect, vi } from 'vitest';
import { isPhotoType, listPhotoLayer } from '../registry-photo-layer.js';

describe('isPhotoType', () => {
  it('api/db_schema/test 是照相层 type', () => {
    expect(isPhotoType('api')).toBe(true);
    expect(isPhotoType('db_schema')).toBe(true);
    expect(isPhotoType('test')).toBe(true);
  });

  it('skill/machine/未知 type 不是照相层', () => {
    expect(isPhotoType('skill')).toBe(false);
    expect(isPhotoType('machine')).toBe(false);
    expect(isPhotoType('hasOwnProperty')).toBe(false);
  });
});

describe('listPhotoLayer', () => {
  function mockPool(rows, freshnessRow) {
    return {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows })
        .mockResolvedValueOnce({ rows: freshnessRow ? [freshnessRow] : [] }),
    };
  }

  const metadata = (repo = 'cecelia') => ({
    repo, scanned_at: new Date(), source_revision: 'abc123', scanner_version: 'api-registry-v2',
  });

  it('无 search:repo 默认 cecelia，items 与 freshness 传播 metadata', async () => {
    const now = new Date();
    const pool = mockPool(
      [{
        id: 1, repo: 'cecelia', method: 'GET', path: '/x', file_path: 'a.js', line_number: 5,
        area: 'cecelia', description: null, scanned_at: now,
        source_revision: 'abc123', scanner_version: 'api-registry-v2',
      }],
      metadata(),
    );
    const r = await listPhotoLayer(pool, 'api', {});
    expect(pool.query.mock.calls[0][0]).toContain('api_registry');
    expect(pool.query.mock.calls[0][0]).toContain('WHERE repo = $1');
    expect(pool.query.mock.calls[0][0]).toContain('LIMIT $2 OFFSET $3');
    expect(pool.query.mock.calls[0][1]).toEqual(['cecelia', 50, 0]);
    expect(r.items[0].name).toBe('GET /x');
    expect(r.items[0].location).toBe('a.js:5');
    expect(r.items[0]).toMatchObject({
      repo: 'cecelia', source_revision: 'abc123', scanner_version: 'api-registry-v2',
      last_success_at: now,
    });
    expect(r.count).toBe(1);
    expect(r).toMatchObject({ repo: 'cecelia', source_revision: 'abc123', scanner_version: 'api-registry-v2' });
    expect(r.freshness).toMatchObject({
      repo: 'cecelia', status: 'fresh', source_revision: 'abc123', scanner_version: 'api-registry-v2',
    });
  });

  it('带 search/repo:占位符顺延，items 与 latest metadata 查询都严格过滤 repo', async () => {
    const pool = mockPool([], metadata('repo-x'));
    await listPhotoLayer(pool, 'test', { repo: 'repo-x', search: 'foo', limit: 10, offset: 2 });
    expect(pool.query.mock.calls[0][0]).toContain('WHERE repo = $1 AND');
    expect(pool.query.mock.calls[0][0]).toContain('LIMIT $4 OFFSET $5');
    expect(pool.query.mock.calls[0][1]).toEqual(['repo-x', '%foo%', '%foo%', 10, 2]);
    expect(pool.query.mock.calls[1][0]).toMatch(/WHERE repo = \$1[\s\S]+ORDER BY scanned_at DESC[\s\S]+LIMIT 1/);
    expect(pool.query.mock.calls[1][0]).not.toMatch(/max\s*\(/i);
    expect(pool.query.mock.calls[1][1]).toEqual(['repo-x']);
  });

  it('该 repo 无 snapshot → items:[] 且 freshness unknown/snapshot_missing', async () => {
    const pool = mockPool([], null);
    const r = await listPhotoLayer(pool, 'db_schema', { repo: 'missing-repo' });
    expect(r.items).toEqual([]);
    expect(r.freshness).toMatchObject({
      repo: 'missing-repo', status: 'unknown', reason_code: 'snapshot_missing', stale: true,
    });
  });
});
