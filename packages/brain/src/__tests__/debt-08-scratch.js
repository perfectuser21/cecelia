import { privatePgConfig, verifyPrivatePg } from '../../../../scripts/ci/private-pg-contract.mjs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// 显式选择 loopback scratch；绝不使用 db.js 的默认连接或读取凭据。
export async function openDebt08Scratch(migrations) {
  const config = privatePgConfig();
  const schema = `debt08_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool(config);
  await verifyPrivatePg(admin);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ ...config, options: `-c search_path=${schema}` });
  try {
    await pool.query('CREATE TABLE schema_version (version text PRIMARY KEY, description text, applied_at timestamptz DEFAULT now())');
    for (const migration of ['000_base_schema.sql', ...migrations]) {
      const sql = await readFile(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8');
      await pool.query(sql);
    }
  } catch (error) {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw error;
  }
  return { pool, async close() {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  } };
}
