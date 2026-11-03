/**
 * captures DB schema test
 * 验证 captures 表和 owner 字段已在 DB 中正确创建
 * 显式schema跑道读取已迁移的专用数据库；连接失败必须使验收失败。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import {isIP} from 'node:net';

const { Pool } = pg;

let pool: InstanceType<typeof Pool>;
beforeAll(async () => {
  let url: URL;
  try { url = new URL(process.env.TEST_DATABASE_URL || ''); }
  catch { throw new Error('captures schema requires an explicit isolated TEST_DATABASE_URL'); }
  if (process.env.API_CAPTURE_SCHEMA_INTEGRATION !== '1'
    || !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1'].includes(url.hostname)
    || !['/cecelia_scratch', '/cecelia_test'].includes(url.pathname)
    || (url.pathname === '/cecelia_test' && process.env.CI !== 'true')
    || url.search || url.hash || !url.username) {
    throw new Error('captures schema only accepts an explicit local scratch or CI test database');
  }
  pool = new Pool({connectionString: url.href, max: 1, connectionTimeoutMillis: 2000,
    query_timeout: 5000, options: '-c default_transaction_read_only=on -c statement_timeout=5000'});
  const {rows} = await pool.query(`SELECT current_database() AS db,
    host(inet_server_addr()) AS address, inet_server_port() AS port`);
  const expectedAddress = process.env.CI_PG_SERVER_ADDRESS;
  if (expectedAddress && !isIP(expectedAddress)) throw new Error('Invalid owned PostgreSQL service address');
  expect(rows[0]).toEqual({db: url.pathname.slice(1),
    address: expectedAddress || expect.stringMatching(/^(127\.0\.0\.1|::1)$/), port: Number(url.port || 5432)});
});

afterAll(async () => {
  await pool?.end();
});

describe('captures table schema', () => {
  it('captures 表存在', async () => {
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'captures'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('captures 表含必要字段', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'captures'`
    );
    const columns = res.rows.map((r: { column_name: string }) => r.column_name);
    const required = ['id', 'content', 'source', 'status', 'area_id', 'project_id', 'extracted_to', 'owner', 'created_at', 'updated_at'];
    for (const col of required) {
      expect(columns, `缺少 ${col} 字段`).toContain(col);
    }
  });

  it('areas 表含 owner 字段', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'areas' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('objectives 表含 owner 字段', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'objectives' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('key_results 表含 owner 字段', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'key_results' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });

  it('okr_projects 表含 owner 字段', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'okr_projects' AND column_name = 'owner'`
    );
    expect(res.rows.length).toBe(1);
  });
});
