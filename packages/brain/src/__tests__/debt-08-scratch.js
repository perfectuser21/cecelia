import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// 显式选择 loopback scratch；绝不使用 db.js 的默认连接或读取凭据。
export async function openDebt08Scratch(migrations) {
  const port = Number(process.env.DEBT08_PG_PORT);
  if (!Number.isInteger(port) || port < 1024 || port === 5432) {
    throw new Error('DEBT08_PG_PORT 必须指向自建私有 PostgreSQL 随机端口');
  }
  const schema = `debt08_${randomUUID().replaceAll('-', '')}`;
  const config = { host: '127.0.0.1', port, user: process.env.DEBT08_PG_USER || 'debt08',
    password: '', database: 'cecelia_scratch', connectionTimeoutMillis: 3000 };
  const admin = new pg.Pool(config);
  const { rows: [identity] } = await admin.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
  if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== port) {
    await admin.end();
    throw new Error('scratch 数据库身份核验失败');
  }
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
