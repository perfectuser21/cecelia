import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
import pg from 'pg';

const client = new pg.Client(privatePgConfig());
let started = false;
export const pool = {
  async start() {
    await client.connect();
    await verifyPrivatePg(client);
    // 序列化共享 scratch 的聚合查询；所有写入在文件结束回滚。
    await client.query('SELECT pg_advisory_lock(670005)');
    await client.query('BEGIN');
    started = true;
  },
  async query(sql, params) {
    if (!started) throw new Error('debt-05 scratch transaction not started');
    await client.query('SAVEPOINT debt05_query');
    try {
      const result = await client.query(sql, params);
      await client.query('RELEASE SAVEPOINT debt05_query');
      return result;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT debt05_query');
      await client.query('RELEASE SAVEPOINT debt05_query');
      throw error;
    }
  },
  async end() {
    if (started) {
      await client.query('ROLLBACK');
      await client.query('SELECT pg_advisory_unlock(670005)');
      started = false;
    }
    await client.end();
  },
};
