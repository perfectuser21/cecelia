import { privatePgConfig, verifyPrivatePg } from '../../../../scripts/ci/private-pg-contract.mjs';
// 第06路：只接受显式 loopback scratch，独立 schema；缺配置直接失败，绝不默认连接。
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const config = privatePgConfig();
const schema = `debt_06_${randomUUID().replaceAll('-', '')}`;
export const pool = new pg.Pool({ ...config, options: `-c search_path=${schema}` });
export async function prepare(migrations) {
  await verifyPrivatePg(pool);
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const migration of migrations) {
    await pool.query(await readFile(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
  }
}
export async function close() {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
}
