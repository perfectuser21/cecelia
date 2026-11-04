// 第07路真实 PG 合同：仅显式 opt-in 的本机 scratch；每份测试独立 schema。
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
let activePool;
export function getDebt07Pool() {
  if (!activePool) throw new Error('第07路 PG 夹具尚未初始化');
  return activePool;
}
export async function createDebt07Fixture() {
  const env = process.env;
  if (env.POSTGRES_INTEGRATION !== '1' || env.DB_HOST !== '127.0.0.1' ||
      env.DB_NAME !== 'cecelia_scratch' || !/^\d+$/.test(env.DB_PORT || '') ||
      !env.DB_USER || !env.DB_PASSWORD && env.DB_PASSWORD !== '') {
    throw new Error('需要显式 POSTGRES_INTEGRATION=1、127.0.0.1、cecelia_scratch 和私有 DB_PORT/DB_USER/DB_PASSWORD');
  }
  const config = { host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME,
    user: env.DB_USER, password: env.DB_PASSWORD, max: 2, connectionTimeoutMillis: 2000 };
  const admin = new pg.Pool(config);
  const schema = `debt07_${randomUUID().replaceAll('-', '')}`;
  try {
    const { rows: [identity] } = await admin.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port');
    if (identity.db !== 'cecelia_scratch' || identity.host !== '127.0.0.1' || identity.port !== config.port) {
      throw new Error('scratch 数据库身份校验失败');
    }
    await admin.query(`CREATE SCHEMA ${schema}`);
    activePool = new pg.Pool({ ...config, options: `-c search_path=${schema}` });
    // 直接执行版本库中的正式基础迁移；不复制表结构或查询实现。
    await activePool.query(readFileSync(new URL('../../../migrations/000_base_schema.sql', import.meta.url), 'utf8'));
    return { pool: activePool, schema, identity, async close() {
      await activePool.end();
      activePool = undefined;
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    } };
  } catch (error) {
    if (activePool) await activePool.end();
    activePool = undefined;
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    throw error;
  }
}
