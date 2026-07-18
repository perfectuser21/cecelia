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
  function mockPool(rows, latest) {
    return {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows })
        .mockResolvedValueOnce({ rows: [{ latest }] }),
    };
  }

  it('无 search:LIMIT $1 OFFSET $2,items 字段映射正确', async () => {
    const now = new Date();
    const pool = mockPool(
      [{ id: 1, method: 'GET', path: '/x', file_path: 'a.js', line_number: 5, area: 'cecelia', description: null, scanned_at: now }],
      now
    );
    const r = await listPhotoLayer(pool, 'api', {});
    expect(pool.query.mock.calls[0][0]).toContain('api_registry');
    expect(pool.query.mock.calls[0][0]).toContain('LIMIT $1 OFFSET $2');
    expect(pool.query.mock.calls[0][1]).toEqual([50, 0]);
    expect(r.items[0].name).toBe('GET /x');
    expect(r.items[0].location).toBe('a.js:5');
    expect(r.count).toBe(1);
    expect(r.freshness.stale).toBe(false);
  });

  it('带 search:占位符顺延为 $3/$4 且 search 参数在前', async () => {
    const pool = mockPool([], new Date());
    await listPhotoLayer(pool, 'test', { search: 'foo', limit: 10, offset: 2 });
    expect(pool.query.mock.calls[0][0]).toContain('LIMIT $3 OFFSET $4');
    expect(pool.query.mock.calls[0][1]).toEqual(['%foo%', '%foo%', 10, 2]);
  });

  it('空表 → items:[] 且 freshness.stale:true', async () => {
    const pool = mockPool([], null);
    const r = await listPhotoLayer(pool, 'db_schema', {});
    expect(r.items).toEqual([]);
    expect(r.freshness.stale).toBe(true);
  });
});
