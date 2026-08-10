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
  const sha40 = 'a'.repeat(40);
  function mockPool(rows, freshnessRow) {
    const query = vi.fn(async (sql) => {
      const text = String(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };
      if (text.includes('fact_snapshot_headers')) {
        return { rows: freshnessRow ? [{ ...freshnessRow, row_count: rows.length }] : [] };
      }
      if (text.includes('ORDER BY scanned_at DESC')) {
        return { rows: freshnessRow ? [freshnessRow] : [] };
      }
      return { rows };
    });
    const client = { query, release: vi.fn() };
    return { query, connect: vi.fn(async () => client), client };
  }

  const metadata = (repo = 'cecelia') => ({
    repo, scanned_at: new Date(), source_revision: sha40, scanner_version: 'api-registry-v2',
  });

  it('无 search:repo 默认 cecelia，items 与 freshness 传播 metadata', async () => {
    const now = new Date();
    const pool = mockPool(
      [{
        id: 1, repo: 'cecelia', method: 'GET', path: '/x', file_path: 'a.js', line_number: 5,
        area: 'cecelia', description: null, scanned_at: now,
        source_revision: sha40, scanner_version: 'api-registry-v2',
      }],
      metadata(),
    );
    const r = await listPhotoLayer(pool, 'api', {});
    expect(pool.connect).toHaveBeenCalledOnce();
    const factsCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM api_registry'));
    expect(factsCall[0]).toContain('WHERE repo = $1');
    expect(factsCall[0]).toContain('LIMIT $2 OFFSET $3');
    expect(factsCall[1]).toEqual(['cecelia', 50, 0]);
    expect(pool.query.mock.calls[0][0]).toMatch(/BEGIN[\s\S]+REPEATABLE READ[\s\S]+READ ONLY/i);
    expect(pool.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(pool.client.release).toHaveBeenCalledOnce();
    expect(r.items[0].name).toBe('GET /x');
    expect(r.items[0].location).toBe('a.js:5');
    expect(r.items[0]).toMatchObject({
      repo: 'cecelia', source_revision: sha40, scanner_version: 'api-registry-v2',
      last_success_at: now,
    });
    expect(r.count).toBe(1);
    expect(r).toMatchObject({ repo: 'cecelia', source_revision: sha40, scanner_version: 'api-registry-v2' });
    expect(r.freshness).toMatchObject({
      repo: 'cecelia', status: 'fresh', source_revision: sha40, scanner_version: 'api-registry-v2',
    });
  });

  it('带 search/repo:占位符顺延，items 与 latest metadata 查询都严格过滤 repo', async () => {
    const pool = mockPool([], metadata('repo-x'));
    await listPhotoLayer(pool, 'test', { repo: 'repo-x', search: 'foo', limit: 10, offset: 2 });
    const factsCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM test_registry'));
    expect(factsCall[0]).toContain('WHERE repo = $1 AND');
    expect(factsCall[0]).toContain('LIMIT $4 OFFSET $5');
    expect(factsCall[1]).toEqual(['repo-x', '%foo%', '%foo%', 10, 2]);
    const headerCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('fact_snapshot_headers'));
    expect(headerCall[0]).toMatch(/WHERE kind = \$1 AND repo = \$2/);
    expect(headerCall[1]).toEqual(['test', 'repo-x']);
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
