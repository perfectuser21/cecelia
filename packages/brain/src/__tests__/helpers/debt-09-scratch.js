import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// 显式 scratch URL + 服务端身份读回。绝不回退到 db.js 或默认端口。
export async function createDebt09Scratch() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('必须显式提供私有 TEST_DATABASE_URL');
  const url = new URL(raw);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/cecelia_scratch' || !url.port || url.port === '5432') {
    throw new Error('仅允许 127.0.0.1 非默认端口的 cecelia_scratch');
  }
  const admin = new pg.Pool({ connectionString: raw });
  const schema = `debt_09_${randomUUID().replaceAll('-', '')}`;
  let pool;
  try {
    const { rows: [identity] } = await admin.query('SELECT current_database() AS db, inet_server_addr()::text AS host, inet_server_port() AS port');
    if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== Number(url.port)) {
      throw new Error('scratch 服务端身份不符');
    }
    console.log('debt-09 scratch identity', identity);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: raw, options: `-c search_path=${schema}` });
    return {
      pool,
      async migrate(name) {
        await pool.query(await readFile(new URL(`../../../migrations/${name}`, import.meta.url), 'utf8'));
      },
      async close() {
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      },
    };
  } catch (error) {
    if (pool) await pool.end();
    await admin.end();
    throw error;
  }
}
