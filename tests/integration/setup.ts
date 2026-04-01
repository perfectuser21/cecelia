/**
 * Integration test shared setup
 * 真实 PostgreSQL 连接，不 mock 任何内部模块
 */
import pg from 'pg';

export const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

export const DB_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'cecelia',
  password: process.env.PGPASSWORD || 'cecelia_ci',
  database: process.env.PGDATABASE || 'cecelia',
};

export async function createTestPool(): Promise<pg.Pool> {
  const pool = new pg.Pool(DB_CONFIG);
  // 验证连接
  await pool.query('SELECT 1');
  return pool;
}

export const TEST_PREFIX = 'TEST_INTEGRATION_';

export async function cleanupTestData(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TEST_PREFIX}%`]);
}
