import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { listPhotoLayer } from '../../lib/registry-photo-layer.js';
import { DB_DEFAULTS } from '../../db-config.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const MARK = 'itest-photo-layer';
// 破坏性清库场景只在测试库执行(死规矩:禁对本地 cecelia 做 DELETE 全表)
const isTestDb = /_test$|_scratch$/.test(DB_DEFAULTS.database || '');

beforeAll(async () => {
  await pool.query(`DELETE FROM api_registry WHERE file_path LIKE $1`, [`${MARK}%`]);
  await pool.query(
    `INSERT INTO api_registry (method, path, file_path, line_number, area, scanned_at)
     VALUES ('GET', '/itest/fresh', $1, 1, 'cecelia', NOW()),
            ('POST', '/itest/old', $2, 2, 'cecelia', NOW() - interval '25 hours')`,
    [`${MARK}/fresh.js`, `${MARK}/old.js`]
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM api_registry WHERE file_path LIKE $1`, [`${MARK}%`]);
  await pool.end();
});

describe('照相层真库查询', () => {
  it('search 命中 marker 行,字段映射正确', async () => {
    const r = await listPhotoLayer(pool, 'api', { search: MARK });
    expect(r.items.length).toBe(2);
    const fresh = r.items.find((i) => i.name === 'GET /itest/fresh');
    expect(fresh.location).toBe(`${MARK}/fresh.js:1`);
    expect(r.freshness).toHaveProperty('stale');
    expect(typeof r.freshness.stale).toBe('boolean');
  });

  it('db_schema 真表可查(至少含本库真实表)', async () => {
    const r = await listPhotoLayer(pool, 'db_schema', { limit: 5 });
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.freshness).toHaveProperty('latest_scan');
  });

  it.runIf(isTestDb)('proven-to-fire:全表只剩 25h 旧行 → stale:true;插入新行 → stale:false', async () => {
    await pool.query(`DELETE FROM api_registry WHERE file_path NOT LIKE $1`, [`${MARK}%`]);
    await pool.query(`DELETE FROM api_registry WHERE file_path = $1`, [`${MARK}/fresh.js`]);
    const stale = await listPhotoLayer(pool, 'api', {});
    expect(stale.freshness.stale).toBe(true);
    await pool.query(
      `INSERT INTO api_registry (method, path, file_path, line_number, area, scanned_at)
       VALUES ('GET', '/itest/fresh2', $1, 3, 'cecelia', NOW())`,
      [`${MARK}/fresh2.js`]
    );
    const ok = await listPhotoLayer(pool, 'api', {});
    expect(ok.freshness.stale).toBe(false);
  });
});
