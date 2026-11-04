import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// 显式 scratch URL + 服务端身份读回。绝不回退到 db.js 或默认端口。
export async function createDebt09Scratch() {
  const config = privatePgConfig();
  const admin = new pg.Pool(config);
  const schema = `debt_09_${randomUUID().replaceAll('-', '')}`;
  let pool;
  try {
    const identity = await verifyPrivatePg(admin);
    console.log('debt-09 scratch identity', identity);
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ ...config, options: `-c search_path=${schema}` });
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
