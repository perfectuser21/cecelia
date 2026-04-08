/**
 * captures DB schema test
 * 验证 captures 表和 owner 字段已在 DB 中正确创建
 * CI 无 PostgreSQL 时自动跳过
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

let pool: InstanceType<typeof Pool>;
let dbAvailable = false;

beforeAll(async () => {
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'cecelia',
    user: process.env.DB_USER || 'cecelia',
    password: process.env.DB_PASSWORD || 'CeceliaUS2026',
  });
  try {
    await pool.query('SELECT 1');
    dbAvailable = true;
  } catch {
    // DB not available in this environment (e.g. CI without PostgreSQL service)
  }
});

afterAll(async () => {
  await pool.end();
});

describe('captures table schema', () => {
  it('captures 表存在', async () => {
    if (!dbAvailable) return;
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'captures'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('captures 表含必要字段', async () => {
    if (!dbAvailable) return;
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'captures'`
    );
    const columns = res.rows.map((r: { column_name: string }) => r.column_name);
    const required = ['id', 'content', 'source', 'status', 'area_id', 'project_id', 'extracted_to', 'owner', 'created_at', 'updated_at'];
    for (const col of required) {
      expect(columns, `缺少 ${col} 字段`).toContain(col);
    }
  });

  it('areas 表含 owner 字段', async () => {
    if (!dbAvailable) return;
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'areas' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('objectives 表含 owner 字段', async () => {
    if (!dbAvailable) return;
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'objectives' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('key_results 表含 owner 字段', async () => {
    if (!dbAvailable) return;
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'key_results' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('okr_projects 表含 owner 字段', async () => {
    if (!dbAvailable) return;
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'okr_projects' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });
});
