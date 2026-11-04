import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
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
  const config = privatePgConfig();
  const admin = new pg.Pool(config);
  const schema = `debt07_${randomUUID().replaceAll('-', '')}`;
  try {
    const identity = await verifyPrivatePg(admin);
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
