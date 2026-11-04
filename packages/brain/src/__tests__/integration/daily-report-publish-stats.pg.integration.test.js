import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
vi.mock('../../db.js', () => ({ default: {} }));
vi.mock('../../notifier.js', () => ({ sendFeishu: vi.fn() }));
import { fetchYesterdayPublishStats } from '../../daily-report-generator.js';
const pool = new pg.Pool(DB_DEFAULTS);
const platform = `frontier3-${randomUUID()}`;
afterAll(async () => { await pool.query('DELETE FROM content_publish_jobs WHERE platform=$1', [platform]); await pool.end(); });
describe('日报按发布队列success合同统计真实PG记录', () => {
  it('success算成功，failed算失败，pending/running与窗口外不混入', async () => {
    for (const status of ['success', 'failed', 'pending', 'running']) {
      await pool.query(`INSERT INTO content_publish_jobs(platform,content_type,status,created_at) VALUES($1,'video',$2,'2026-11-03T12:00:00Z')`, [platform, status]);
    }
    await pool.query(`INSERT INTO content_publish_jobs(platform,content_type,status,created_at) VALUES($1,'video','success','2026-11-02T12:00:00Z')`, [platform]);
    const rows = await fetchYesterdayPublishStats(pool, '2026-11-03');
    expect(rows.find(row => row.platform === platform)).toEqual({ platform, success: 1, failed: 1 });
  });
});
