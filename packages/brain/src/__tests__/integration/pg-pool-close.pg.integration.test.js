import pg from 'pg';
import { expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { closePgPool, trackPgPool } from './helpers/close-pg-pool.js';

it('真实 PG 错误查询释放连接后，socket 退出前不能继续清库', async () => {
  const pool = trackPgPool(new pg.Pool({ ...DB_DEFAULTS, max: 1 }));
  let removed = false;
  pool.on('remove', () => { removed = true; });
  try {
    await expect(pool.query('SELECT 1/0')).rejects.toMatchObject({ code: '22012' });
    await closePgPool(pool);
    expect(removed).toBe(true);
  } finally {
    if (!pool.ending) await pool.end();
  }
});
