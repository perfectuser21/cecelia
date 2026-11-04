// 第06路：只接受显式 loopback scratch，独立 schema；缺配置直接失败，绝不默认连接。
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const address = new URL(process.env.DEBT_06_DATABASE_URL || 'invalid:');
if (address.protocol !== 'postgresql:' || address.hostname !== '127.0.0.1'
  || !address.port || address.port === '5432' || address.pathname !== '/cecelia_scratch') {
  throw new Error('DEBT_06_DATABASE_URL 必须显式指向私有 127.0.0.1 非5432端口/cecelia_scratch');
}
const schema = `debt_06_${randomUUID().replaceAll('-', '')}`;
export const pool = new pg.Pool({ connectionString: address.href, options: `-c search_path=${schema}` });
export async function prepare(migrations) {
  const { rows: [identity] } = await pool.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
  if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== Number(address.port)) throw new Error('scratch 身份核验失败');
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const migration of migrations) {
    await pool.query(await readFile(new URL(`../../migrations/${migration}`, import.meta.url), 'utf8'));
  }
}
export async function close() {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
}
