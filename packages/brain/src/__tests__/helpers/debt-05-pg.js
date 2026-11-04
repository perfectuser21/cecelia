import pg from 'pg';

// 本组只接受显式私有 scratch，缺配置时在建立连接前拒绝。
const env = process.env;
if (env.POSTGRES_INTEGRATION !== '1' || env.DB_HOST !== '127.0.0.1' ||
    env.DB_NAME !== 'cecelia_scratch' || !/^\d+$/.test(env.DB_PORT || '') ||
    ['5432', '5221'].includes(env.DB_PORT) || !env.DB_USER) {
  throw new Error('debt-05 requires explicit private loopback cecelia_scratch PostgreSQL');
}
const client = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT),
  database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD || '',
  connectionTimeoutMillis: 3000 });
let started = false;
export const pool = {
  async start() {
    await client.connect();
    const { rows: [identity] } = await client.query(
      'SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
    if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== Number(env.DB_PORT)) {
      await client.end();
      throw new Error('debt-05 scratch identity mismatch');
    }
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
